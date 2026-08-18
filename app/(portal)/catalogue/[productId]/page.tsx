import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { requireB2BCustomerCached, type AuthFailure } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { ProductDetailClient } from '@/components/shop/ProductDetailClient'
import { loadCatalogueItemDecorations } from '@/lib/shop/decorations'
import {
  resolveCatalogueItemForPdp,
  resolvePdpImageContext,
} from '@/lib/shop/resolve-catalogue-item'
import { resolveStockPurchasePrices } from '@/lib/shop/stock-purchase-price'
import { getEffectiveMaxQty } from '@/lib/shop/effective-max-qty'
import { getEffectiveMoq } from '@/lib/shop/effective-moq'
import { effectiveUnitPriceForItem } from '@/lib/shop/effective-price'
import { cleanDescriptionForDisplay } from '@/lib/shop/clean-description'
import { stripTrailingSku } from '@/lib/shop/strip-trailing-sku'
import { effectiveFulfilment } from '@/lib/shop/fulfilment-mode'
import { normalizeCatalogueImageView } from '@/lib/shop/catalogue-image-view'
import { pickPreferredGalleryImageUrl, hiddenViewSetForColour } from '@/lib/shop/catalogue-images'
import { resolveColourMatrix, type MatrixVariant } from '@/lib/shop/colour-matrix'
import type { VariantAvailability } from '@/lib/shop/variant-availability'
import {
  getOpenPeriodForOrg,
  getPreOrderItemIds,
  getPeriodBracketsForItem,
} from '@/lib/pricing/period-brackets'
import { getPreOrderDemandForItem } from '@/lib/pricing/preorder-demand'
import type { ImageLayout } from '@/lib/shop/image-layout'

type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'

interface ProductDetail {
  id: string
  name: string
  description: string | null
  image_url: string | null
  moq: number | null
  max_order_qty: number | null
  lead_time_days: number | null
  sizing_type: string | null
  decoration_methods: string[] | null
  decoration_price: number | null
  is_active: boolean
  sku: string | null
  safety_standard: string | null
  specs: Record<string, unknown> | null
  supports_labels: boolean | null
  garment_family: string | null
  default_sizes: string[] | null
  fulfilment_type: FulfilmentType | null
  image_layout: ImageLayout
  brands: { name: string } | { name: string }[] | null
  categories: { name: string } | { name: string }[] | null
}

interface RawVariant {
  id: string
  color_swatch_id: string | null
  product_color_swatches:
    | { label: string | null; hex: string | null; position: number | null; image_url: string | null }
    | { label: string | null; hex: string | null; position: number | null; image_url: string | null }[]
    | null
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

type ProductDetailClientProps = Parameters<typeof ProductDetailClient>[0]

type ProductDetailLoadResult =
  | { status: 'auth-failure'; failure: AuthFailure }
  | { status: 'not-found' }
  | { status: 'ok'; data: ProductDetailClientProps }

interface ProductDetailPageProps {
  params: Promise<{ productId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

const loadProductDetailPageData = cache(async (
  productId: string,
): Promise<ProductDetailLoadResult> => {
  const auth = await requireB2BCustomerCached()
  if ('kind' in auth) return { status: 'auth-failure', failure: auth }
  const { admin, context } = auth

  // Per-member access filter — gate before we reach the product table.
  // Editor preview force-shows the exact in-edit skin; a stale or cross-product
  // preview item falls back to the member's normal granted access for this
  // product instead of hard-404ing (see resolveCatalogueItemForPdp).
  const catItem = await resolveCatalogueItemForPdp(admin, {
    productId,
    organizationId: context.organizationId,
    membershipId: context.membershipId,
    isPreview: context.isPreview === true,
    previewItemId: context.previewItemId ?? null,
  })

  if (!catItem) return { status: 'not-found' }

  const productSelect = 'id, name, description, image_url, moq, max_order_qty, lead_time_days, sizing_type, decoration_methods, decoration_price, is_active, sku, safety_standard, specs, supports_labels, garment_family, default_sizes, fulfilment_type, image_layout, brands!products_brand_id_fkey(name), categories!products_category_id_fkey(name)'

  const productQuery = admin
    .from('products')
    .select(productSelect)
    .eq('id', productId)
    .single()

  // Brackets come from the canonical pricing engine, not the manual ladder
  // table. Probing `effective_unit_price` at the canonical breakpoints
  // catches markup-ladder products (where the manual ladder is empty) AND
  // manual-ladder products (engine routes through manual rows when present).
  // Adjacent bands with identical prices collapse into one.
  //
  // qty=1 is intentionally NOT probed: `garment_markup_tiers` has a row
  // 1-23 with multiplier 1.0, so effective_unit_price at qty=1 returns
  // base_cost × tier — wholesale, not retail. Including it leaked a
  // misleadingly-cheap "1-23" band into the Volume pricing widget for
  // markup-ladder products. 24 is the actual B2B floor for printed gear.
  const CANONICAL_BREAKPOINTS: number[] = [24, 50, 100, 250, 500, 1000]

  // Manual-final items have an explicitly staff-authored ladder in
  // b2b_catalogue_item_pricing_tiers, and `effective_unit_price_for_item` reads
  // exactly that ladder for them (tier multiplier forced to 1.0). So probing the
  // canonical breakpoints misrepresents them: a band the staff authored outside
  // the canonical list (a 1-23 band, say) never surfaced, and band edges came
  // from probe spacing rather than from the authored max_quantity. Read the
  // authored bands instead and use THEIR From qty values as the probe points.
  //
  // Computed items are untouched: their ladder is derived, they have no rows in
  // that table, and qty 1 must stay unprobed there (it returns base_cost x the
  // 1-23 markup tier — wholesale, which leaked a misleadingly-cheap band).
  const authoredBands: Array<{
    min_quantity: number
    max_quantity: number | null
  }> =
    catItem.price_mode === 'manual_final'
      ? (
          (
            await admin
              .from('b2b_catalogue_item_pricing_tiers')
              .select('min_quantity, max_quantity')
              .eq('catalogue_item_id', catItem.id)
              .order('min_quantity', { ascending: true })
          ).data ?? []
        ).map((b) => ({
          min_quantity: Number(b.min_quantity),
          max_quantity: b.max_quantity == null ? null : Number(b.max_quantity),
        }))
      : []

  // The qty points every server-side pricing probe on this page samples. Kept as
  // one list so the garment ladder and the decoration seed can never disagree.
  const BREAKPOINTS: number[] =
    authoredBands.length > 0
      ? authoredBands.map((b) => b.min_quantity)
      : CANONICAL_BREAKPOINTS

  const bracketsQuery = (async () => {
    const probes: Array<{ qty: number; price: number | null }> = await Promise.all(
      BREAKPOINTS.map(async (qty) => {
        // Item-keyed (Phase 1): the loader already resolved catItem.id, so we
        // price the specific skin rather than re-resolving the product via the
        // legacy LIMIT 1 lookup. Identical output for single-skin products;
        // correct once a product carries multiple skins. Per-probe failures are
        // swallowed so a transient pricing error never breaks the PDP.
        try {
          const price = await effectiveUnitPriceForItem(
            admin,
            catItem.id,
            context.organizationId,
            qty,
          )
          return { qty, price }
        } catch {
          return { qty, price: null }
        }
      }),
    )
    const points = probes.filter(
      (p): p is { qty: number; price: number } => p.price != null,
    )
    if (points.length === 0) {
      return { data: [] as Array<{ min_quantity: number; max_quantity: number | null; unit_price: number }> }
    }
    // Authored ladder: the staff decided these bands, so render them as authored
    // — no run-collapsing, and max_quantity straight off the row rather than
    // inferred from the next probe. Bands whose price failed to resolve drop out.
    if (authoredBands.length > 0) {
      const priceByMin = new Map(points.map((p) => [p.qty, p.price]))
      return {
        data: authoredBands
          .filter((b) => priceByMin.has(b.min_quantity))
          .map((b) => ({
            min_quantity: b.min_quantity,
            max_quantity: b.max_quantity,
            unit_price: priceByMin.get(b.min_quantity) as number,
          })),
      }
    }
    // First pass: drop runs where price equals the previous kept point. Each
    // remaining "interesting" point is the start of a band.
    const interesting: Array<{ qty: number; price: number }> = []
    for (const p of points) {
      const last = interesting[interesting.length - 1]
      if (!last || last.price !== p.price) interesting.push(p)
    }
    // Second pass: each band's max_quantity is the NEXT interesting point's
    // qty minus one, or null for the tail. Collapsed probes get absorbed
    // into the previous band's range — at qty 24 with [{1,A},{24,A},{50,B}],
    // band 1 spans 1..49, not 1..23.
    const bands = interesting.map((p, i) => ({
      min_quantity: p.qty,
      max_quantity: i + 1 < interesting.length ? interesting[i + 1].qty - 1 : null,
      unit_price: p.price,
    }))
    return { data: bands }
  })()

  // Manual-final: seed the combined decoration figure per canonical breakpoint
  // server-side so the PDP renders the correct decoration on first paint, without
  // depending on the client decoration-pricing fetch (which can be gated/raced).
  // Empty for computed items (engine returns NULL → omitted).
  const manualDecorationSeedQuery = (async (): Promise<Record<number, number>> => {
    if (catItem.price_mode !== 'manual_final') return {}
    const seed: Record<number, number> = {}
    await Promise.all(
      BREAKPOINTS.map(async (qty) => {
        try {
          const { data, error } = await admin.rpc('catalogue_item_decoration_price', {
            p_catalogue_item_id: catItem.id,
            p_qty: qty,
          })
          if (!error && data != null && Number.isFinite(Number(data))) seed[qty] = Number(data)
        } catch {
          // per-probe failure swallowed — client fetch remains a fallback
        }
      }),
    )
    return seed
  })()

  const [
    { data: product },
    { data: variants },
    { data: sizeRows },
    { data: brackets },
    { data: availRows },
    { data: imageRows },
    { data: catalogueColorRows },
    { data: catalogueImageRows },
    { data: hiddenViewRows },
    { data: galleryOrderRows },
    decorations,
    manualDecorationSeed,
  ] = await Promise.all([
    productQuery,
    admin.from('product_variants')
      .select(`
        id, color_swatch_id,
        product_color_swatches (label, hex, position, image_url)
      `)
      .eq('product_id', productId)
      .eq('is_active', true),
    admin.from('sizes')
      .select('id, label, order_index')
      .eq('product_id', productId)
      .order('order_index', { ascending: true }),
    bracketsQuery,
    admin.from('variant_availability')
      .select('variant_id, size_id, available_qty, allow_order_without_stock')
      .eq('organization_id', context.organizationId),
    admin.from('product_images')
      .select('id, file_url, view, alt_text, position, color_swatch_id')
      .eq('product_id', productId)
      .order('position', { ascending: true }),
    admin.from('b2b_catalogue_item_colors')
      .select('color_swatch_id, sort_order, is_default, product_color_swatches(label, hex, position)')
      .eq('catalogue_item_id', catItem.id)
      .order('sort_order', { ascending: true, nullsFirst: false }),
    admin.from('b2b_catalogue_item_images')
      .select('id, image_url, view, alt_text, position, color_swatch_id, source')
      .eq('catalogue_item_id', catItem.id)
      .eq('is_published', true)
      .order('position', { ascending: true }),
    admin.from('b2b_catalogue_item_hidden_views')
      .select('color_swatch_id, view')
      .eq('catalogue_item_id', catItem.id),
    admin.from('b2b_catalogue_item_gallery_order')
      .select('product_image_id, catalogue_item_image_id, position')
      .eq('catalogue_item_id', catItem.id),
    loadCatalogueItemDecorations(admin, catItem.id),
    manualDecorationSeedQuery,
  ])

  const productRow = product as unknown as ProductDetail | null
  // Preview force-show: a still-draft (is_active=false) product must render
  // when the staff preview launched straight to this item's PDP.
  if (!productRow || (!productRow.is_active && !context.isPreview)) return { status: 'not-found' }
  const { imageLayout, galleryPosition } = resolvePdpImageContext(
    productRow.image_layout,
    catItem.image_layout_override,
    (galleryOrderRows ?? []) as Array<{
      product_image_id: string | null
      catalogue_item_image_id: string | null
      position: number
    }>,
  )

  // Spec 3a — per-variant billing class (variant_inventory.billing_mode), keyed
  // by the product's variants for this org. Replaces the item-level read: the
  // "Pre-paid" badge + cart snapshot now follow the SELECTED variant's class.
  // A variant is prepaid if ANY of its size rows is prepaid; absent → invoiced.
  const variantIds = ((variants ?? []) as Array<{ id: string }>).map((v) => v.id)
  const { data: billingRows } = variantIds.length
    ? await admin
        .from('variant_inventory')
        .select('variant_id, billing_mode')
        .eq('organization_id', context.organizationId)
        .in('variant_id', variantIds)
    : { data: [] as Array<{ variant_id: string; billing_mode: string | null }> }
  const billingModeByVariant: Record<string, 'invoice_on_dispatch' | 'prepaid'> = {}
  for (const r of (billingRows ?? []) as Array<{ variant_id: string; billing_mode: string | null }>) {
    if (r.billing_mode === 'prepaid') billingModeByVariant[r.variant_id] = 'prepaid'
    else if (!(r.variant_id in billingModeByVariant)) billingModeByVariant[r.variant_id] = 'invoice_on_dispatch'
  }

  const catalogueColors = (catalogueColorRows ?? []) as Array<{
    color_swatch_id: string
    sort_order: number | null
    is_default: boolean | null
    product_color_swatches:
      | { label: string | null; hex: string | null; position: number | null }
      | { label: string | null; hex: string | null; position: number | null }[]
      | null
  }>
  // Only colours explicitly added to this catalogue item (b2b_catalogue_item_colors)
  // are shown. The set also drives ordering and the default colour selection.
  const colorConfigById = new Map(catalogueColors.map((row) => [row.color_swatch_id, row]))
  const addedSwatchIds = new Set(catalogueColors.map((row) => row.color_swatch_id))

  const variantRows = (variants ?? []) as unknown as RawVariant[]
  // SKUCOLLAPSE: product_variants is colourway-grain — no size axis on the row.
  // The size dimension comes from `mappedSizes` (the product's sizes) and stock
  // from `variant_availability` (keyed variant×size); the client resolves each
  // size against the sizeless colourway variant. size_* stay null here.
  const mappedVariantRows: MatrixVariant[] = variantRows.map((v) => {
    const swatch = pickOne(v.product_color_swatches)
    const colorConfig = v.color_swatch_id ? colorConfigById.get(v.color_swatch_id) : null
    return {
      variant_id: v.id,
      color_swatch_id: v.color_swatch_id,
      color_label: swatch?.label ?? null,
      color_hex: swatch?.hex ?? null,
      color_image_url: swatch?.image_url ?? null,
      color_position: swatch?.position ?? 0,
      catalogue_color_sort_order: colorConfig?.sort_order ?? null,
      catalogue_color_is_default: colorConfig?.is_default === true,
      size_id: null,
      size_label: null,
      size_order: 0,
    }
  })

  // Per-product size list (colourway model) → the runtime size picker / grid.
  const mappedSizes = ((sizeRows ?? []) as Array<{
    id: number
    label: string | null
    order_index: number | null
  }>).map((s) => ({
    size_id: s.id,
    size_label: s.label,
    size_order: s.order_index ?? 0,
  }))
  const { colourOptions, variants: mappedVariants } = resolveColourMatrix(mappedVariantRows, addedSwatchIds)

  // SKUCOLLAPSE: keyed `${variant_id}::${size_id}` (size_id '' when null) — one
  // stock row per colourway×size. Mirrors lib/shop/variant-availability
  // availabilityKey + the availability API route.
  const availability: Record<string, VariantAvailability> = {}
  for (const r of (availRows ?? []) as Array<{
    variant_id: string
    size_id: number | null
    available_qty: number
    allow_order_without_stock: boolean | null
  }>) {
    availability[`${r.variant_id}::${r.size_id ?? ''}`] = {
      available_qty: r.available_qty,
      allow_order_without_stock: r.allow_order_without_stock === true,
    }
  }

  const catalogueImages = ((catalogueImageRows ?? []) as Array<{
    id: string
    image_url: string | null
    view: string | null
    alt_text: string | null
    position: number | null
    color_swatch_id: string | null
    source: 'designer_snapshot' | 'staff_upload' | 'staff_pick' | null
  }>)
    .filter((r) => r.image_url)
    .map((r) => ({
      id: `catalogue:${r.id}`,
      source_id: r.id,
      url: r.image_url as string,
      view: normalizeCatalogueImageView(r.view, r.image_url),
      persisted_view: r.view,
      alt: r.alt_text,
      position: r.position,
      color_swatch_id: r.color_swatch_id,
      scope: 'catalogue' as const,
      source: r.source,
      gallery_position:
        galleryPosition.get(`catalogue:${r.id}`) ?? null,
    }))

  const masterImages = ((imageRows ?? []) as Array<{
    id: string
    file_url: string | null
    view: string | null
    alt_text: string | null
    position: number | null
    color_swatch_id: string | null
  }>)
    .filter((r) => r.file_url)
    .map((r) => ({
      id: `master:${r.id}`,
      source_id: r.id,
      url: r.file_url as string,
      view: normalizeCatalogueImageView(r.view, r.file_url),
      alt: r.alt_text,
      position: r.position,
      color_swatch_id: r.color_swatch_id,
      scope: 'master' as const,
      gallery_position: galleryPosition.get(`master:${r.id}`) ?? null,
    }))
  // Each colour's own swatch photo, as a per-colour master image. The gallery
  // resolver ranks this priority 4 — below catalogue decoration images (p1–p3)
  // but above the generic product fallback (p5) — so a surfaced, undecorated
  // colour shows its real photo instead of every colour sharing one image.
  const swatchImages = colourOptions
    .filter((o) => o.imageUrl)
    .map((o) => ({
      id: `swatch:${o.id}`,
      url: o.imageUrl as string,
      view: 'front',
      alt: o.label,
      position: 0,
      color_swatch_id: o.id,
      scope: 'master' as const,
      synthetic: true,
    }))
  const images = [...catalogueImages, ...masterImages, ...swatchImages]

  const existingBracketRows = (brackets ?? []) as {
    min_quantity: number
    max_quantity: number | null
    unit_price: number
  }[]

  // Pre-order: when this catalogue item is pre_order fulfilment type, swap the
  // bracket source to the period snapshot (spec §3.5). If the item is pre_order
  // but no period is open, keep the live brackets for display but gate the CTA.
  const catalogueItemId = catItem.id ?? null
  const openPeriod = await getOpenPeriodForOrg(admin, context.organizationId)
  const preOrderIds = catalogueItemId
    ? await getPreOrderItemIds(admin, [catalogueItemId])
    : new Set<string>()
  const isPreOrderItem = catalogueItemId != null && preOrderIds.has(catalogueItemId)
  const preOrderClosed = isPreOrderItem && !openPeriod
  let bracketRows = existingBracketRows
  if (isPreOrderItem && openPeriod && catalogueItemId) {
    const periodBrackets = await getPeriodBracketsForItem(
      admin,
      openPeriod.id,
      catalogueItemId,
    )
    if (periodBrackets.length > 0) {
      bracketRows = periodBrackets.map((b) => ({
        min_quantity: b.minQty,
        max_quantity: b.maxQty,
        unit_price: b.unitPrice,
      }))
    }
  }

  // Pre-order franchise demand (whole-network, current open window). Gated to
  // franchise tenants; fail-soft (helper returns null on any miss/error).
  const preOrderDemand =
    context.tenantType === 'franchise' && isPreOrderItem && openPeriod && catalogueItemId
      ? await getPreOrderDemandForItem(admin, context.organizationId, catalogueItemId)
      : null

  // Spec 3a follow-up — for PREPAID variants, surface the per-unit price of
  // the band the stock was originally purchased at (informational: a prepaid
  // draw is $0 at checkout). Linked intake → original quote-item price;
  // unlinked → current ladder at the intake qty.
  const prepaidVariantIds = Object.entries(billingModeByVariant)
    .filter(([, mode]) => mode === 'prepaid')
    .map(([variantId]) => variantId)
  const stockPurchasePrices = await resolveStockPurchasePrices(
    admin,
    context.organizationId,
    prepaidVariantIds,
    bracketRows,
  )
  const stockPurchasePriceByVariant: Record<string, number> = {}
  for (const [variantId, price] of stockPurchasePrices) {
    stockPurchasePriceByVariant[variantId] = price
  }

  const brandName = Array.isArray(productRow.brands)
    ? (productRow.brands[0]?.name ?? null)
    : productRow.brands?.name ?? null
  const categoryName = Array.isArray(productRow.categories)
    ? (productRow.categories[0]?.name ?? null)
    : productRow.categories?.name ?? null

  const catItemForked = catItem as {
    name: string
    description: string | null
    sku_override: string | null
    moq_override: number | null
    max_order_qty_override: number | null
    fulfilment_type_override: FulfilmentType | null
  } | null
  // Views staff hid from the customer PDP (b2b_catalogue_item_hidden_views),
  // scoped per (catalogue item, colour). Threaded to the client so the gallery
  // drops them per selected colour; also applied to the server-side fallback.
  const hiddenViewRowsClean = ((hiddenViewRows ?? []) as Array<{
    color_swatch_id: string | null
    view: string | null
  }>)
    .filter((r) => r.color_swatch_id && r.view)
    .map((r) => ({ color_swatch_id: r.color_swatch_id, view: String(r.view).toLowerCase() }))

  const catalogueFallbackImageUrl = pickPreferredGalleryImageUrl(
    images,
    colourOptions[0]?.id ?? null,
    productRow.image_url,
    hiddenViewSetForColour(hiddenViewRowsClean, colourOptions[0]?.id ?? null),
    imageLayout,
  )

  const displayDescription = cleanDescriptionForDisplay(
    catItemForked?.description ?? productRow.description,
  )

  const displayProduct = {
    ...productRow,
    name: stripTrailingSku(catItemForked?.name ?? productRow.name, productRow.sku),
    description: displayDescription?.format === 'plain' ? displayDescription.text : null,
    image_url: catalogueFallbackImageUrl,
    sku: catItemForked?.sku_override ?? productRow.sku,
  }

  const effectiveMoq = getEffectiveMoq(
    { moq: productRow.moq },
    catItemForked ? { moq_override: catItemForked.moq_override } : null,
    { orgMoqExempt: context.moqExempt },
  )

  // Feature #9 — soft per-order cap. Warn-only: threaded to the client for the
  // add-time toast; never gates add-to-cart.
  const effectiveMaxQty = getEffectiveMaxQty(
    { max_order_qty: productRow.max_order_qty },
    catItemForked ? { max_order_qty_override: catItemForked.max_order_qty_override } : null,
  )

  // Feature 1 — resolve the assigned org location dataset's values into PDP
  // dropdown options. Empty = no location dropdown for this product.
  let locationOptions: Array<{ value: string; label: string }> = []
  if (catItem.line_dataset_id) {
    const { data: locationValues } = await admin
      .from('org_line_dataset_values')
      .select('id, label')
      .eq('dataset_id', catItem.line_dataset_id)
      .order('position', { ascending: true })
    locationOptions = (locationValues ?? []).map((v) => ({
      value: String(v.id),
      label: String(v.label),
    }))
  }

  return {
    status: 'ok',
    data: {
      product: {
        id: displayProduct.id,
        name: displayProduct.name,
        // Garment Name mirrors the catalogue grid's "Product" line: the blank
        // garment name, derived exactly like catalogue/page.tsx —
        // stripTrailingSku(product name, effective SKU). displayProduct.sku already
        // carries the catalogue-item sku_override, matching the grid's effectiveSku.
        garment_name: stripTrailingSku(productRow.name, displayProduct.sku),
        description: displayProduct.description,
        description_html:
          displayDescription?.format === 'rich' ? displayDescription.html : null,
        image_url: displayProduct.image_url,
        moq: displayProduct.moq,
        lead_time_days: displayProduct.lead_time_days,
        sizing_type: displayProduct.sizing_type,
        decoration_methods: displayProduct.decoration_methods,
        decoration_price: displayProduct.decoration_price,
        sku: displayProduct.sku,
        safety_standard: displayProduct.safety_standard,
        specs: displayProduct.specs,
        supports_labels: displayProduct.supports_labels,
        garment_family: displayProduct.garment_family,
        default_sizes: displayProduct.default_sizes,
        fulfilment_type: effectiveFulfilment(
          catItemForked?.fulfilment_type_override ?? null,
          displayProduct.fulfilment_type,
        ),
        brand_name: brandName,
        category_name: categoryName,
        // Phase 2 — catalogue-item identity threaded to the client so it can ride
        // the cart line through checkout into submit_b2b_order. `catItem.id` was
        // already resolved server-side; we just stop dropping it.
        catalogueItemId: catItem.id ?? null,
        // Pooled decoration pricing (2026-08-13 spec) — the owning catalogue and
        // its opt-in flag, snapshotted onto the cart line at add-time. Pools never
        // cross catalogues; the flag is false for every catalogue at ship time, so
        // this is inert until a catalogue is explicitly opted in.
        catalogueId: catItem.catalogue_id ?? null,
        poolingEnabled: catItem.decoration_pooling_enabled === true,
        // Manual-final pricing (2026-06-10). Drives the client to read the
        // item's combined decoration figure instead of summing per-placement.
        priceMode: (catItem.price_mode as 'computed' | 'manual_final' | null) ?? 'computed',
        // Manual-final: combined decoration per canonical breakpoint, resolved
        // server-side so the PDP shows the right decoration immediately.
        manualDecorationSeed,
      },
      variants: mappedVariants,
      sizes: mappedSizes,
      brackets: bracketRows,
      availability,
      // Spec 3a — variant_id → billing class for the "Pre-paid" badge + cart snapshot.
      billingModeByVariant,
      // Spec 3a follow-up — variant_id → original-purchase unit price (prepaid only).
      stockPurchasePriceByVariant,
      // Explicit ex-GST stock sell price (Stock-on-hand). null = not set →
      // existing single-price display, never the volume ladder. numeric → number.
      stockUnitPrice:
        catItem.stock_unit_price == null ? null : Number(catItem.stock_unit_price),
      organizationId: context.organizationId,
      customerRole: context.role,
      orderingPermission: context.orderingPermission,
      images,
      imageLayout,
      hiddenViewRows: hiddenViewRowsClean,
      colourOptions,
      decorations,
      effectiveMoq,
      effectiveMaxQty,
      preOrderClosed,
      // Display-only: hide these bands from the Volume-pricing widget
      // (cart/checkout brackets are untouched, so price & MOQ unchanged).
      volumeDisplayHiddenBands: catItem.volume_display_hidden_bands ?? [],
      // Display-only: the order staff dragged these bands into. Applied after
      // the hide filter; cart brackets stay ascending, so price & MOQ unchanged.
      volumeDisplayBandOrder: catItem.volume_display_band_order ?? [],
      // Feature 1 — org location dropdown options. Empty = no location dropdown.
      locationOptions,
      // Feature 2 — per-product custom-name cap. null = no custom-name input.
      customNameMaxLength: catItem.custom_name_max_length ?? null,
      // Pre-order franchise: whole-network demand for this product in the open
      // window. null => not shown (non-franchise, non-pre-order, or no window).
      preOrderDemand,
    },
  }
})

export async function generateMetadata({
  params,
}: ProductDetailPageProps): Promise<Metadata> {
  const { productId } = await params
  const result = await loadProductDetailPageData(productId)

  return {
    title: result.status === 'ok' ? result.data.product.name : 'Product',
  }
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: ProductDetailPageProps) {
  const { productId } = await params
  const [result, sp] = await Promise.all([
    loadProductDetailPageData(productId),
    searchParams,
  ])

  if (result.status === 'auth-failure') return handleAuthFailure(result.failure)
  if (result.status === 'not-found') notFound()

  // `?color=` deep-link from the catalogue grid's exploded tiles. Validate it
  // against the colours this product actually exposes so a stale link can never
  // preselect a missing colour. Resolved here (not in the cached loader, which
  // is keyed on productId only) so the per-request colour never poisons the cache.
  const colorParam = typeof sp.color === 'string' ? sp.color : null
  const availableSwatchIds = new Set<string>([
    ...(result.data.colourOptions ?? []).map((c) => c.id),
    ...result.data.variants
      .map((v) => v.color_swatch_id)
      .filter((x): x is string => !!x),
  ])
  const initialColorSwatchId =
    colorParam && availableSwatchIds.has(colorParam) ? colorParam : null

  return (
    <ProductDetailClient {...result.data} initialColorSwatchId={initialColorSwatchId} />
  )
}
