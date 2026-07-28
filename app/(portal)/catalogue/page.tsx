import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireB2BCustomerCached } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { effectiveUnitPricesBulk } from '@/lib/shop/effective-price'
import { CatalogueGrid } from '@/components/shop/CatalogueGrid'
import { CatalogueTopBar } from '@/components/shop/CatalogueTopBar'
import { SetTopBarContext } from '@/components/layout/PortalTopBarContext'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { FilterRail } from '@/components/shop/FilterRail'
import { FilterSheetTrigger } from '@/components/shop/FilterSheetTrigger'
import { parseShopFilters, activeFilterCount } from '@/lib/shop/filter-params'
import { getShopFacets } from '@/lib/shop/facets'
import { effectiveFulfilment, matchesMode, memberCanReorder, type FulfilmentType } from '@/lib/shop/fulfilment-mode'
import {
  pickCatalogueCardThumbnail,
  pickCatalogueColourThumbnail,
  type CatalogueItemImageRow,
} from '@/lib/shop/catalogue-images'
import { getGrantedCatalogueItems } from '@/lib/shop/member-access'
import { stripTrailingSku } from '@/lib/shop/strip-trailing-sku'
import {
  resolveCatalogueDecorationPrices,
  type CatalogueDecorationRow,
} from '@/lib/shop/catalogue-decoration-prices'

export const metadata: Metadata = {
  title: 'Catalogue',
}

// Tenants that track physical stock — for these, the catalogue listing is
// unioned with any product that has a variant_inventory row. Studio tenants
// stay catalogue-only.
const INVENTORY_TENANT_TYPES = new Set(['studio_plus_inventory', 'franchise'])
const DEFAULT_FLOOR_QTY = 1000
// Entry quantity for the high end of the card price range. The catalogue-wide
// MOQ — both the manual price ladders and the garment markup tiers treat 24 as
// the first real order band (the 24-49 markup multiplier is also the steepest),
// so the all-in price at qty 24 is the most expensive a customer realistically
// pays. The floor qty (largest markup tier) gives the cheapest volume price.
const ENTRY_QTY = 24

interface ProductRow {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  brand_id: string
  category_id: string
  garment_family: string | null
  moq: number | null
  created_at: string | null
}

type CatalogueSwatchEmbed = {
  hex: string | null
  label: string | null
  position: number | null
  image_url: string | null
}

type CatalogueSwatchRow = {
  catalogue_item_id: string
  sort_order: number | null
  color_swatch_id: string | null
  // Included so the lead-colour pick can be derived from this same result set
  // instead of a second query against b2b_catalogue_item_colors.
  is_default: boolean | null
  product_color_swatches:
    | CatalogueSwatchEmbed
    | CatalogueSwatchEmbed[]
    | null
}

async function loadCatalogueFloorQty(admin: SupabaseClient): Promise<number> {
  const { data } = await admin
    .from('garment_markup_tiers')
    .select('min_qty')
    .eq('is_active', true)
    .order('min_qty', { ascending: false })
    .limit(1)
    .maybeSingle()

  const value = Number(data?.min_qty ?? DEFAULT_FLOOR_QTY)
  return Number.isFinite(value) && value >= 1 ? value : DEFAULT_FLOOR_QTY
}

async function loadTierMultiplier(admin: SupabaseClient, organizationId: string): Promise<number> {
  const { data } = await admin
    .from('b2b_accounts')
    .select('tier_discount_override, customer_pricing_tiers!inner(multiplier)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return 1
  if (data.tier_discount_override != null) {
    const override = Number(data.tier_discount_override)
    return Number.isFinite(override) && override > 0 ? override : 1
  }

  const tier = Array.isArray(data.customer_pricing_tiers)
    ? data.customer_pricing_tiers[0]
    : data.customer_pricing_tiers
  const multiplier = Number((tier as { multiplier?: number | string } | null)?.multiplier ?? 1)
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const filters = parseShopFilters(sp)
  const auth = await requireB2BCustomerCached()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  // Hoisted: floorQty is catalogue-global and tierMultiplier keys only on
  // organizationId, so neither depends on the resolved product set. Start their
  // round-trips now so they overlap the granted-items / products waves instead
  // of adding a serial hop right before pricing.
  const floorQtyPromise = loadCatalogueFloorQty(admin)
  const tierMultiplierPromise = loadTierMultiplier(admin, context.organizationId)

  const limit = 24
  const offset = (filters.page - 1) * limit

  // Full member-visible catalogue item rows resolved in ONE pass. Previously the
  // grid resolved the ids here and then re-queried b2b_catalogue_items for the
  // very same rows' columns — a redundant remote round-trip on the hot path.
  const catItemRows = (await getGrantedCatalogueItems(
    admin,
    context.membershipId,
    context.organizationId,
  )) as unknown as Array<{
    id: string
    source_product_id: string
    fulfilment_type_override: FulfilmentType | null
    card_image_id: string | null
    price_mode: 'computed' | 'manual_final' | null
  }>
  const priceModeByItemId = new Map(catItemRows.map((r) => [r.id, r.price_mode]))
  const productIdByItemId = new Map(catItemRows.map((r) => [r.id, r.source_product_id]))

  // Inventory tenants: union curated catalogue with any product they track
  // stock for. Studio tenants stay catalogue-only. Today this rarely adds
  // products (PRT's tracked products are already in their catalogue), but the
  // union is the correct data model for any future split.
  const inventoryProductIds = new Set<string>()
  if (context.tenantType && INVENTORY_TENANT_TYPES.has(context.tenantType)) {
    const { data: invRows } = await admin
      .from('variant_inventory')
      .select('product_variants!inner(product_id)')
      .eq('organization_id', context.organizationId)
    type InvRow = {
      product_variants:
        | { product_id: string }
        | { product_id: string }[]
        | null
    }
    for (const r of (invRows ?? []) as InvRow[]) {
      const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants
      if (pv?.product_id) inventoryProductIds.add(pv.product_id)
    }
  }
  const catalogueProductIds = new Set(catItemRows.map((r) => r.source_product_id))
  const scopedProductIds = Array.from(new Set([...catalogueProductIds, ...inventoryProductIds]))

  // Ordering-mode filter (Item 2): keep only products whose effective mode
  // (override ?? base) matches the selected pill. Override is per catalogue
  // item; base is products.fulfilment_type. Falls back to base when no override.
  let modeScopedProductIds = scopedProductIds
  if (filters.mode !== 'all' && scopedProductIds.length > 0) {
    const overrideByProductId = new Map<string, FulfilmentType | null>(
      catItemRows.map((r) => [r.source_product_id, r.fulfilment_type_override]),
    )
    const { data: baseRows } = await admin
      .from('products')
      .select('id, fulfilment_type')
      .in('id', scopedProductIds)
    const baseByProductId = new Map<string, FulfilmentType | null>(
      ((baseRows ?? []) as Array<{ id: string; fulfilment_type: FulfilmentType | null }>).map(
        (r) => [r.id, r.fulfilment_type],
      ),
    )
    modeScopedProductIds = scopedProductIds.filter((pid) =>
      matchesMode(
        effectiveFulfilment(overrideByProductId.get(pid) ?? null, baseByProductId.get(pid) ?? null),
        filters.mode,
      ),
    )
  }

  if (modeScopedProductIds.length === 0) {
    return (
      <div className="space-y-6 p-4 md:p-8">
        <PortalEmptyState
          title="Your catalogue is being set up"
          body="Your account manager will let you know when products are ready for ordering."
          actionHref="mailto:hello@theprint-room.co.nz"
          actionLabel="Contact sales"
        />
      </div>
    )
  }

  const orderColumn = filters.sort === 'newest' ? 'created_at' : 'name'
  const orderAscending = filters.sort !== 'newest'

  let q = admin
    .from('products')
    .select('id, name, sku, image_url, brand_id, category_id, garment_family, moq, created_at', { count: 'exact' })
    .eq('is_active', true)
    .in('id', modeScopedProductIds)

  if (filters.q) q = q.ilike('name', `%${filters.q}%`)
  if (filters.brandId) q = q.eq('brand_id', filters.brandId)
  if (filters.categoryId) q = q.eq('category_id', filters.categoryId)
  if (filters.garmentFamily) q = q.eq('garment_family', filters.garmentFamily)

  q = q.order(orderColumn, { ascending: orderAscending }).range(offset, offset + limit - 1)

  const [{ data: productData, count: totalCount }, facets] = await Promise.all([
    q,
    getShopFacets(admin, scopedProductIds),
  ])

  const rows = (productData ?? []) as unknown as ProductRow[]
  const totalProducts = totalCount ?? rows.length
  const pageCount = Math.max(1, Math.ceil(totalProducts / limit))

  const productIds = rows.map((r) => r.id)
  // Already in flight since just after auth (see hoist above) — this await only
  // joins their results back into the render.
  const [floorQty, tierMultiplier] = await Promise.all([floorQtyPromise, tierMultiplierPromise])
  // Two price points per card: floor qty = cheapest volume price (low end of
  // the range), ENTRY_QTY = most expensive realistic order (high end).
  const qtyByProduct: Record<string, number> = Object.fromEntries(
    rows.map((r) => [r.id, floorQty]),
  )
  const qtyEntryByProduct: Record<string, number> = Object.fromEntries(
    rows.map((r) => [r.id, ENTRY_QTY]),
  )
  const scopedItemIds = catItemRows
    .filter((r) => productIds.includes(r.source_product_id))
    .map((r) => r.id)
  const itemIdByProductId = new Map(
    catItemRows
      .filter((r) => productIds.includes(r.source_product_id))
      .map((r) => [r.source_product_id, r.id]),
  )
  const [
    { prices: pricesLow },
    { prices: pricesHigh },
    { data: catalogueImageRows },
    { data: decorationRows },
    { data: stockRows },
    { data: swatchRows },
  ] = await Promise.all([
    effectiveUnitPricesBulk(admin, productIds, context.organizationId, qtyByProduct),
    effectiveUnitPricesBulk(admin, productIds, context.organizationId, qtyEntryByProduct),
    scopedItemIds.length > 0
      ? admin
          .from('b2b_catalogue_item_images')
          .select('id, catalogue_item_id, view, source, position, image_url, color_swatch_id')
          .in('catalogue_item_id', scopedItemIds)
          .eq('is_published', true)
          .order('position', { ascending: true })
      : Promise.resolve({ data: [] as CatalogueItemImageRow[] }),
    scopedItemIds.length > 0
      ? admin
          .from('b2b_catalogue_item_decorations')
          .select('catalogue_item_id, org_decoration_id, org_decorations(unit_price)')
          .in('catalogue_item_id', scopedItemIds)
          .eq('is_default', true)
          .eq('is_published', true)
      : Promise.resolve({
          data: [] as Array<{
            catalogue_item_id: string
            org_decoration_id: string | null
            org_decorations:
              | { unit_price: number | null }
              | { unit_price: number | null }[]
              | null
          }>,
        }),
    // Stock totals per product for the inline chip. Untracked products
    // (no variant_inventory rows) return no row → total_stock stays null.
    productIds.length > 0 && context.tenantType && INVENTORY_TENANT_TYPES.has(context.tenantType)
      ? admin
          .from('variant_availability')
          .select('available_qty, product_variants!inner(product_id)')
          .eq('organization_id', context.organizationId)
          .in('product_variants.product_id', productIds)
      : Promise.resolve({
          data: [] as Array<{
            available_qty: number
            product_variants:
              | { product_id: string }
              | { product_id: string }[]
              | null
          }>,
        }),
    // Card swatches: catalogue-scoped colours joined to product_color_swatches
    // for hex + label. Ordered by catalogue sort_order ASC then swatch position.
    scopedItemIds.length > 0
      ? admin
          .from('b2b_catalogue_item_colors')
          .select(
            'catalogue_item_id, sort_order, color_swatch_id, is_default, product_color_swatches(hex, label, position, image_url)',
          )
          .in('catalogue_item_id', scopedItemIds)
          .order('sort_order', { ascending: true, nullsFirst: false })
      : Promise.resolve({
          data: [] as CatalogueSwatchRow[],
        }),
  ])

  const productImageById = new Map(rows.map((row) => [row.id, row.image_url]))
  const imagesByProduct = new Map<string, CatalogueItemImageRow[]>()
  for (const row of (catalogueImageRows ?? []) as CatalogueItemImageRow[]) {
    const productId = productIdByItemId.get(row.catalogue_item_id)
    if (!productId) continue
    const list = imagesByProduct.get(productId) ?? []
    list.push(row)
    imagesByProduct.set(productId, list)
  }

  // Explicit card picks: bypass is_published so a staff_pick image that is
  // unpublished can still be used as the card thumbnail.
  const cardImageIds = catItemRows
    .filter((r) => productIds.includes(r.source_product_id) && r.card_image_id != null)
    .map((r) => r.card_image_id as string)
  const cardImageIdToUrl = new Map<string, string>()
  if (cardImageIds.length > 0) {
    const { data: pickedRows } = await admin
      .from('b2b_catalogue_item_images')
      .select('id, image_url')
      .in('id', cardImageIds)
    for (const r of (pickedRows ?? []) as Array<{ id: string; image_url: string | null }>) {
      if (r.image_url) cardImageIdToUrl.set(r.id, r.image_url)
    }
  }

  // Lead colour per item: is_default colour wins, then smallest sort_order (nulls
  // last), else null. Mirrors the staff-side rule exactly. Derived from the
  // swatchRows fetched above (they now carry is_default) rather than a second
  // query against the same b2b_catalogue_item_colors rows.
  const coloursByCatItem = new Map<string, Array<{ color_swatch_id: string | null; is_default: boolean | null; sort_order: number | null }>>()
  for (const r of (swatchRows ?? []) as CatalogueSwatchRow[]) {
    const list = coloursByCatItem.get(r.catalogue_item_id) ?? []
    list.push({ color_swatch_id: r.color_swatch_id, is_default: r.is_default, sort_order: r.sort_order })
    coloursByCatItem.set(r.catalogue_item_id, list)
  }
  const leadColorByItemId = new Map<string, string | null>()
  for (const [itemId, colours] of coloursByCatItem) {
    const sorted = colours.slice().sort((a, b) => {
      if (a.is_default && !b.is_default) return -1
      if (!a.is_default && b.is_default) return 1
      const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER
      const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER
      return ao - bo
    })
    leadColorByItemId.set(itemId, sorted[0]?.color_swatch_id ?? null)
  }

  // Stock total per product_id. Products with no variant_inventory rows
  // resolve to undefined → null on the card (no badge). Products with rows
  // resolve to a number — even zero, which surfaces as "Made to order".
  const stockByProduct = new Map<string, number>()
  for (const r of (stockRows ?? []) as Array<{
    available_qty: number
    product_variants:
      | { product_id: string }
      | { product_id: string }[]
      | null
  }>) {
    const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants
    if (!pv?.product_id) continue
    const cur = stockByProduct.get(pv.product_id) ?? 0
    stockByProduct.set(pv.product_id, cur + (Number.isFinite(r.available_qty) ? r.available_qty : 0))
  }

  // Per-product colour breakdown for the grid's explode: id + label + hex + the
  // colour's own thumbnail (front mockup for that swatch, else product image).
  // Deduped by hex; ordering is catalogue sort_order (already applied in query)
  // → swatch position. Drives both the exploded per-colour tiles and the
  // collapsed card's swatch dots.
  const coloursByProductForGrid = new Map<
    string,
    Array<{ swatchId: string; label: string | null; hex: string | null; imageUrl: string | null }>
  >()
  const seenSwatchHexByProduct = new Map<string, Set<string>>()
  for (const r of (swatchRows ?? []) as CatalogueSwatchRow[]) {
    const productId = productIdByItemId.get(r.catalogue_item_id)
    if (!productId || !r.color_swatch_id) continue
    const swatch = Array.isArray(r.product_color_swatches)
      ? r.product_color_swatches[0]
      : r.product_color_swatches
    if (!swatch) continue
    const seen = seenSwatchHexByProduct.get(productId) ?? new Set<string>()
    const hexKey = (swatch.hex ?? '').toLowerCase()
    if (hexKey && seen.has(hexKey)) continue
    if (hexKey) seen.add(hexKey)
    seenSwatchHexByProduct.set(productId, seen)
    const list = coloursByProductForGrid.get(productId) ?? []
    list.push({
      swatchId: r.color_swatch_id,
      label: swatch.label,
      hex: swatch.hex,
      imageUrl: pickCatalogueColourThumbnail({
        fallbackUrl: productImageById.get(productId) ?? null,
        rows: imagesByProduct.get(productId) ?? [],
        selectedColorSwatchId: r.color_swatch_id,
        swatchImageUrl: swatch.image_url,
      }),
    })
    coloursByProductForGrid.set(productId, list)
  }

  // Decoration overlay per catalogue item at BOTH the floor (cheapest volume)
  // and the entry (most expensive) quantity. The source depends on price_mode:
  //   * manual_final → the ONE combined per-band figure
  //     (catalogue_item_decoration_price, no tier multiplier) — same source the
  //     PDP/cart use for manual items.
  //   * computed → sum of default per-placement decorations
  //     (effective_decoration_unit_price × tier) — the existing rate-sheet path.
  const manualScopedItemIds = catItemRows
    .filter((r) => r.price_mode === 'manual_final' && productIds.includes(r.source_product_id))
    .map((r) => r.id)
  const { decoLowByItem, decoHighByItem } = await resolveCatalogueDecorationPrices(admin, {
    decorationRows: (decorationRows ?? []) as CatalogueDecorationRow[],
    manualScopedItemIds,
    priceModeByItemId,
    floorQty,
    entryQty: ENTRY_QTY,
    tierMultiplier,
  })

  const products = rows.map((p) => {
    const lowPrice =
      pricesLow.get(p.id) ?? { unitPrice: 0, status: 'missing' as const, hasStock: false }
    const highPrice =
      pricesHigh.get(p.id) ?? { unitPrice: 0, status: 'missing' as const, hasStock: false }
    const itemId = itemIdByProductId.get(p.id)
    const decoLow = itemId ? decoLowByItem.get(itemId) ?? 0 : 0
    const decoHigh = itemId ? decoHighByItem.get(itemId) ?? 0 : 0
    const allInLow = lowPrice.unitPrice > 0 ? lowPrice.unitPrice + decoLow : 0
    const allInHigh = highPrice.unitPrice > 0 ? highPrice.unitPrice + decoHigh : 0
    // Range = most expensive (entry qty) → cheapest (floor qty). min/max guard
    // so an inverted multiplier can never flip the display; equal ends collapse
    // to a single price (fixed-price items) in ProductCard.
    const candidates = [allInLow, allInHigh].filter((v) => v > 0)
    const priceLow = candidates.length ? Math.min(...candidates) : 0
    const priceHigh = candidates.length ? Math.max(...candidates) : 0
    const stockTotal = stockByProduct.has(p.id) ? stockByProduct.get(p.id)! : null
    const catItemId = itemIdByProductId.get(p.id)
    const cardImageId = catItemId
      ? (catItemRows.find((r) => r.id === catItemId)?.card_image_id ?? null)
      : null
    const pickedUrl = cardImageId ? (cardImageIdToUrl.get(cardImageId) ?? null) : null
    const leadColorSwatchId = catItemId ? (leadColorByItemId.get(catItemId) ?? null) : null
    return {
      id: p.id,
      name: stripTrailingSku(p.name, p.sku),
      sku: p.sku,
      image_url: pickCatalogueCardThumbnail({
        fallbackUrl: p.image_url,
        rows: imagesByProduct.get(p.id) ?? [],
        leadColorSwatchId,
        explicitCardImageUrl: pickedUrl,
      }),
      type: p.garment_family,
      price_low: priceLow,
      price_high: priceHigh,
      price_status: priceHigh > 0 ? ('ok' as const) : ('missing' as const),
      has_stock: lowPrice.hasStock,
      total_stock: stockTotal,
      colours: coloursByProductForGrid.get(p.id) ?? [],
    }
  })

  const activeCount = activeFilterCount(filters)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SetTopBarContext
        value={{
          kind: 'listing',
          label: 'Catalogue',
          count: totalProducts,
          page: filters.page,
          pageCount,
          filters,
          facets,
          filterAction: '/catalogue',
        }}
      />
      <div className="mx-auto max-w-[1680px] px-4 pb-16 pt-3 motion-safe:animate-portal-enter md:px-8 md:pt-4">
        <CatalogueTopBar
          crumbs={[
            { label: 'Home', href: '/account' },
            { label: 'Catalogue' },
          ]}
        />

        {/* Mobile keeps the bottom-sheet trigger. Desktop filters live in the
            global PortalTopBar's second row (populated via SetTopBarContext). */}
        <div className="mt-4 md:hidden">
          <FilterSheetTrigger activeCount={activeCount}>
            <FilterRail
              filters={filters}
              facets={facets}
              basePath="/catalogue"
              showModeFilter={memberCanReorder(context.orderingPermission)}
            />
          </FilterSheetTrigger>
        </div>

        {products.length === 0 ? (
          <div className="py-8">
            <PortalEmptyState
              title="No products match your filters"
              body="Try clearing some filters."
              actionHref="/catalogue"
              actionLabel="Clear filters"
            />
          </div>
        ) : (
          <div className="mt-4 md:mt-6">
            <CatalogueGrid products={products} />
          </div>
        )}
      </div>
    </div>
  )
}
