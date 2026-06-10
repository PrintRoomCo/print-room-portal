import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { requireB2BCustomerCached, type AuthFailure } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { ProductDetailClient } from '@/components/shop/ProductDetailClient'
import { loadCatalogueItemDecorations } from '@/lib/shop/decorations'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import { getEffectiveMoq } from '@/lib/shop/effective-moq'
import { effectiveUnitPriceForItem } from '@/lib/shop/effective-price'
import { cleanDescription } from '@/lib/shop/clean-description'
import { stripTrailingSku } from '@/lib/shop/strip-trailing-sku'
import { effectiveFulfilment } from '@/lib/shop/fulfilment-mode'
import { normalizeCatalogueImageView } from '@/lib/shop/catalogue-image-view'
import { resolveColourMatrix, type MatrixVariant } from '@/lib/shop/colour-matrix'
import type { VariantAvailability } from '@/lib/shop/variant-availability'

type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'

interface ProductDetail {
  id: string
  name: string
  description: string | null
  image_url: string | null
  moq: number | null
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
  brands: { name: string } | { name: string }[] | null
  categories: { name: string } | { name: string }[] | null
}

interface RawVariant {
  id: string
  color_swatch_id: string | null
  size_id: number | null
  product_color_swatches:
    | { label: string | null; hex: string | null; position: number | null; image_url: string | null }
    | { label: string | null; hex: string | null; position: number | null; image_url: string | null }[]
    | null
  sizes:
    | { label: string | null; order_index: number | null }
    | { label: string | null; order_index: number | null }[]
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
}

const loadProductDetailPageData = cache(async (
  productId: string,
): Promise<ProductDetailLoadResult> => {
  const auth = await requireB2BCustomerCached()
  if ('kind' in auth) return { status: 'auth-failure', failure: auth }
  const { admin, context } = auth

  // Per-member access filter — gate before we even reach the product table.
  const grantedItemIds = await getGrantedCatalogueItemIds(
    admin,
    context.membershipId,
    context.organizationId,
  )
  if (grantedItemIds.length === 0) return { status: 'not-found' }

  const { data: catItem } = await admin
    .from('b2b_catalogue_items')
    .select('id, name, description, sku_override, moq_override, variant_label, fulfilment_type_override, price_mode, b2b_catalogues!inner(is_active)')
    .eq('source_product_id', productId)
    .eq('is_active', true)
    .eq('b2b_catalogues.organization_id', context.organizationId)
    .eq('b2b_catalogues.is_active', true)
    .in('id', grantedItemIds)
    .limit(1)
    .maybeSingle()

  if (!catItem) return { status: 'not-found' }

  const productSelect = 'id, name, description, image_url, moq, lead_time_days, sizing_type, decoration_methods, decoration_price, is_active, sku, safety_standard, specs, supports_labels, garment_family, default_sizes, fulfilment_type, brands!products_brand_id_fkey(name), categories!products_category_id_fkey(name)'

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
  const bracketsQuery = (async () => {
    const probes: Array<{ qty: number; price: number | null }> = await Promise.all(
      CANONICAL_BREAKPOINTS.map(async (qty) => {
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

  const [
    { data: product },
    { data: variants },
    { data: brackets },
    { data: availRows },
    { data: imageRows },
    { data: catalogueColorRows },
    { data: catalogueImageRows },
    decorations,
  ] = await Promise.all([
    productQuery,
    admin.from('product_variants')
      .select(`
        id, color_swatch_id, size_id,
        product_color_swatches (label, hex, position, image_url),
        sizes (label, order_index)
      `)
      .eq('product_id', productId)
      .eq('is_active', true),
    bracketsQuery,
    admin.from('variant_availability')
      .select('variant_id, available_qty, allow_order_without_stock')
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
    loadCatalogueItemDecorations(admin, catItem.id),
  ])

  const productRow = product as unknown as ProductDetail | null
  if (!productRow || !productRow.is_active) return { status: 'not-found' }

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
  const mappedVariantRows: MatrixVariant[] = variantRows.map((v) => {
    const swatch = pickOne(v.product_color_swatches)
    const size = pickOne(v.sizes)
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
      size_id: v.size_id,
      size_label: size?.label ?? null,
      size_order: size?.order_index ?? 0,
    }
  })
  const { colourOptions, variants: mappedVariants } = resolveColourMatrix(mappedVariantRows, addedSwatchIds)

  const availability: Record<string, VariantAvailability> = {}
  for (const r of (availRows ?? []) as Array<{
    variant_id: string
    available_qty: number
    allow_order_without_stock: boolean | null
  }>) {
    availability[r.variant_id] = {
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
      url: r.image_url as string,
      view: normalizeCatalogueImageView(r.view, r.image_url),
      alt: r.alt_text,
      position: r.position,
      color_swatch_id: r.color_swatch_id,
      scope: 'catalogue' as const,
      source: r.source,
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
      url: r.file_url as string,
      view: normalizeCatalogueImageView(r.view, r.file_url),
      alt: r.alt_text,
      position: r.position,
      color_swatch_id: r.color_swatch_id,
      scope: 'master' as const,
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
    }))
  const images = [...catalogueImages, ...masterImages, ...swatchImages]

  const bracketRows = (brackets ?? []) as {
    min_quantity: number
    max_quantity: number | null
    unit_price: number
  }[]

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
    variant_label: string | null
    fulfilment_type_override: FulfilmentType | null
  } | null

  const displayProduct = {
    ...productRow,
    name: stripTrailingSku(catItemForked?.name ?? productRow.name, productRow.sku),
    description: cleanDescription(catItemForked?.description ?? productRow.description),
    image_url: productRow.image_url,
    sku: catItemForked?.sku_override ?? productRow.sku,
  }

  const effectiveMoq = getEffectiveMoq(
    { moq: productRow.moq },
    catItemForked ? { moq_override: catItemForked.moq_override } : null,
    { orgMoqExempt: context.moqExempt },
  )

  return {
    status: 'ok',
    data: {
      product: {
        id: displayProduct.id,
        name: displayProduct.name,
        description: displayProduct.description,
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
        catalogueVariantLabel: catItemForked?.variant_label ?? null,
        // Manual-final pricing (2026-06-10). Drives the client to read the
        // item's combined decoration figure instead of summing per-placement.
        priceMode: (catItem.price_mode as 'computed' | 'manual_final' | null) ?? 'computed',
      },
      variants: mappedVariants,
      brackets: bracketRows,
      availability,
      organizationId: context.organizationId,
      customerRole: context.role,
      images,
      colourOptions,
      decorations,
      effectiveMoq,
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
}: ProductDetailPageProps) {
  const { productId } = await params
  const result = await loadProductDetailPageData(productId)

  if (result.status === 'auth-failure') return handleAuthFailure(result.failure)
  if (result.status === 'not-found') notFound()

  return <ProductDetailClient {...result.data} />
}
