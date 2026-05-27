import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { requireB2BCustomerCached } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { effectiveUnitPricesBulk } from '@/lib/shop/effective-price'
import { ProductCard } from '@/components/shop/ProductCard'
import { CatalogueTopBar } from '@/components/shop/CatalogueTopBar'
import { SetTopBarContext } from '@/components/layout/PortalTopBarContext'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { FilterRail } from '@/components/shop/FilterRail'
import { FilterSheetTrigger } from '@/components/shop/FilterSheetTrigger'
import { parseShopFilters, activeFilterCount } from '@/lib/shop/filter-params'
import { getShopFacets } from '@/lib/shop/facets'
import { pickCatalogueItemThumbnail, type CatalogueItemImageRow } from '@/lib/shop/catalogue-images'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import { stripTrailingSku } from '@/lib/shop/strip-trailing-sku'

export const metadata: Metadata = {
  title: 'Catalogue',
}

// Tenants that track physical stock — for these, the catalogue listing is
// unioned with any product that has a variant_inventory row. Studio tenants
// stay catalogue-only.
const INVENTORY_TENANT_TYPES = new Set(['studio_plus_inventory', 'franchise'])
const DEFAULT_FLOOR_QTY = 1000

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

  const limit = 24
  const offset = (filters.page - 1) * limit

  const grantedItemIds = await getGrantedCatalogueItemIds(
    admin,
    context.membershipId,
    context.organizationId,
  )
  const { data: catItems } = grantedItemIds.length === 0
    ? { data: [] as Array<{ id: string; source_product_id: string }> }
    : await admin
        .from('b2b_catalogue_items')
        .select('id, source_product_id, b2b_catalogues!inner(organization_id, is_active)')
        .eq('b2b_catalogues.organization_id', context.organizationId)
        .eq('b2b_catalogues.is_active', true)
        .eq('is_active', true)
        .in('id', grantedItemIds)
  const catItemRows = (catItems ?? []) as Array<{ id: string; source_product_id: string }>
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

  if (scopedProductIds.length === 0) {
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
    .in('id', scopedProductIds)

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
  const [floorQty, tierMultiplier] = await Promise.all([
    loadCatalogueFloorQty(admin),
    loadTierMultiplier(admin, context.organizationId),
  ])
  const qtyByProduct: Record<string, number> = Object.fromEntries(
    rows.map((r) => [r.id, floorQty]),
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
    { prices },
    { data: catalogueImageRows },
    { data: decorationRows },
    { data: stockRows },
    { data: swatchRows },
  ] = await Promise.all([
    effectiveUnitPricesBulk(admin, productIds, context.organizationId, qtyByProduct),
    scopedItemIds.length > 0
      ? admin
          .from('b2b_catalogue_item_images')
          .select('catalogue_item_id, view, source, position, image_url, color_swatch_id')
          .in('catalogue_item_id', scopedItemIds)
          .eq('is_published', true)
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
            'catalogue_item_id, sort_order, product_color_swatches(hex, label, position)',
          )
          .in('catalogue_item_id', scopedItemIds)
          .order('sort_order', { ascending: true, nullsFirst: false })
      : Promise.resolve({
          data: [] as Array<{
            catalogue_item_id: string
            sort_order: number | null
            product_color_swatches:
              | { hex: string | null; label: string | null; position: number | null }
              | { hex: string | null; label: string | null; position: number | null }[]
              | null
          }>,
        }),
  ])

  const imagesByProduct = new Map<string, CatalogueItemImageRow[]>()
  for (const row of (catalogueImageRows ?? []) as CatalogueItemImageRow[]) {
    const productId = productIdByItemId.get(row.catalogue_item_id)
    if (!productId) continue
    const list = imagesByProduct.get(productId) ?? []
    list.push(row)
    imagesByProduct.set(productId, list)
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

  // Card swatches per product — deduped by hex, capped at 8 to keep the card
  // tidy; ProductCard renders the first 5 + "+N" overflow indicator. Source
  // ordering: catalogue sort_order (already applied in query) → swatch position.
  const swatchesByProduct = new Map<
    string,
    Array<{ hex: string | null; label: string | null }>
  >()
  const seenHexByProduct = new Map<string, Set<string>>()
  for (const r of (swatchRows ?? []) as Array<{
    catalogue_item_id: string
    sort_order: number | null
    product_color_swatches:
      | { hex: string | null; label: string | null; position: number | null }
      | { hex: string | null; label: string | null; position: number | null }[]
      | null
  }>) {
    const productId = productIdByItemId.get(r.catalogue_item_id)
    if (!productId) continue
    const swatch = Array.isArray(r.product_color_swatches)
      ? r.product_color_swatches[0]
      : r.product_color_swatches
    if (!swatch) continue
    const list = swatchesByProduct.get(productId) ?? []
    const seen = seenHexByProduct.get(productId) ?? new Set<string>()
    const key = (swatch.hex ?? '').toLowerCase()
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    list.push({ hex: swatch.hex, label: swatch.label })
    swatchesByProduct.set(productId, list)
    seenHexByProduct.set(productId, seen)
  }

  // Sum of default decorations per catalogue item at the same floor quantity
  // as the garment price. This mirrors the PDP/cart pricing path: engine
  // price first, flat org-decoration fallback for methods without an engine.
  const decorationSumByItem = new Map<string, number>()
  await Promise.all(((decorationRows ?? []) as Array<{
    catalogue_item_id: string
    org_decoration_id: string | null
    org_decorations:
      | { unit_price: number | string | null }
      | { unit_price: number | string | null }[]
      | null
  }>).map(async (r) => {
    if (!r.org_decoration_id) return
    const orgDec = Array.isArray(r.org_decorations) ? r.org_decorations[0] : r.org_decorations
    const fallback = orgDec?.unit_price != null ? Number(orgDec.unit_price) : null
    const { data, error } = await admin.rpc('effective_decoration_unit_price', {
      p_org_decoration_id: r.org_decoration_id,
      p_qty: floorQty,
    })
    const base = !error && data != null ? Number(data) : fallback
    if (base == null || !Number.isFinite(base) || base <= 0) return
    const price = Number((base * tierMultiplier).toFixed(2))
    decorationSumByItem.set(
      r.catalogue_item_id,
      (decorationSumByItem.get(r.catalogue_item_id) ?? 0) + price,
    )
  }))

  const products = rows.map((p) => {
    const rpcPrice =
      prices.get(p.id) ?? { unitPrice: 0, status: 'missing' as const, hasStock: false }
    const itemId = itemIdByProductId.get(p.id)
    const decorationOverlay = itemId ? decorationSumByItem.get(itemId) ?? 0 : 0
    const fromAllIn =
      rpcPrice.unitPrice > 0 ? rpcPrice.unitPrice + decorationOverlay : rpcPrice.unitPrice
    const stockTotal = stockByProduct.has(p.id) ? stockByProduct.get(p.id)! : null
    return {
      id: p.id,
      name: stripTrailingSku(p.name, p.sku),
      sku: p.sku,
      image_url: pickCatalogueItemThumbnail(p.image_url, imagesByProduct.get(p.id) ?? []),
      type: p.garment_family,
      from_unit_price: fromAllIn,
      price_status: rpcPrice.status,
      has_stock: rpcPrice.hasStock,
      total_stock: stockTotal,
      swatches: swatchesByProduct.get(p.id) ?? [],
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
            <FilterRail filters={filters} facets={facets} basePath="/catalogue" />
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
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:mt-6 md:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
            {products.map((p) => (
              <Link
                key={p.id}
                href={`/catalogue/${p.id}`}
                className="block transition-transform duration-150 active:scale-[0.99]"
              >
                <ProductCard product={p} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
