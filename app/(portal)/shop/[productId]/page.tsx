import { notFound } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { ProductDetailClient } from '@/components/shop/ProductDetailClient'
import { loadCatalogueItemDecorations } from '@/lib/shop/decorations'

export const dynamic = 'force-dynamic'

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
  brands: { name: string } | { name: string }[] | null
  categories: { name: string } | { name: string }[] | null
}

interface RawVariant {
  id: string
  color_swatch_id: string | null
  size_id: number | null
  product_color_swatches:
    | { label: string | null; hex: string | null; position: number | null }
    | { label: string | null; hex: string | null; position: number | null }[]
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

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>
}) {
  const { productId } = await params
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  const { data: catItem } = await admin
    .from('b2b_catalogue_items')
    .select('id, name, description, image_url, b2b_catalogues!inner(is_active)')
    .eq('source_product_id', productId)
    .eq('is_active', true)
    .eq('b2b_catalogues.organization_id', context.organizationId)
    .eq('b2b_catalogues.is_active', true)
    .limit(1)
    .maybeSingle()

  if (!catItem) return notFound()

  const productSelect = 'id, name, description, image_url, moq, lead_time_days, sizing_type, decoration_methods, decoration_price, is_active, sku, safety_standard, specs, supports_labels, garment_family, default_sizes, brands!products_brand_id_fkey(name), categories!products_category_id_fkey(name)'

  const productQuery = admin
    .from('products')
    .select(productSelect)
    .eq('id', productId)
    .single()

  const bracketsQuery = admin
    .from('b2b_catalogue_item_pricing_tiers')
    .select('min_quantity, max_quantity, unit_price')
    .eq('catalogue_item_id', catItem.id)
    .order('min_quantity')

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
        product_color_swatches (label, hex, position),
        sizes (label, order_index)
      `)
      .eq('product_id', productId)
      .eq('is_active', true),
    bracketsQuery,
    admin.from('variant_availability')
      .select('variant_id, available_qty')
      .eq('organization_id', context.organizationId),
    admin.from('product_images')
      .select('id, file_url, view, alt_text, position, color_swatch_id')
      .eq('product_id', productId)
      .order('position', { ascending: true }),
    admin.from('b2b_catalogue_item_colors')
      .select('color_swatch_id, sort_order, is_default')
      .eq('catalogue_item_id', catItem.id)
      .order('sort_order', { ascending: true, nullsFirst: false }),
    admin.from('b2b_catalogue_item_images')
      .select('id, image_url, view, alt_text, position, color_swatch_id')
      .eq('catalogue_item_id', catItem.id)
      .order('position', { ascending: true }),
    loadCatalogueItemDecorations(admin, catItem.id),
  ])

  const productRow = product as unknown as ProductDetail | null
  if (!productRow || !productRow.is_active) return notFound()

  const catalogueColors = (catalogueColorRows ?? []) as Array<{
    color_swatch_id: string
    sort_order: number | null
    is_default: boolean | null
  }>
  const configuredColorIds = new Set(catalogueColors.map((row) => row.color_swatch_id))
  const colorConfigById = new Map(catalogueColors.map((row) => [row.color_swatch_id, row]))

  const variantRows = (variants ?? []) as unknown as RawVariant[]
  const mappedVariants = variantRows.map((v) => {
    const swatch = pickOne(v.product_color_swatches)
    const size = pickOne(v.sizes)
    const colorConfig = v.color_swatch_id ? colorConfigById.get(v.color_swatch_id) : null
    return {
      variant_id: v.id,
      color_swatch_id: v.color_swatch_id,
      color_label: swatch?.label ?? null,
      color_hex: swatch?.hex ?? null,
      color_position: swatch?.position ?? 0,
      catalogue_color_sort_order: colorConfig?.sort_order ?? null,
      catalogue_color_is_default: colorConfig?.is_default === true,
      size_id: v.size_id,
      size_label: size?.label ?? null,
      size_order: size?.order_index ?? 0,
    }
  })
    .filter((v) => {
      if (configuredColorIds.size === 0) return true
      return v.color_swatch_id != null && configuredColorIds.has(v.color_swatch_id)
    })
    .sort((a, b) => {
      if (a.catalogue_color_is_default !== b.catalogue_color_is_default) {
        return a.catalogue_color_is_default ? -1 : 1
      }
      const aColor = a.catalogue_color_sort_order ?? a.color_position
      const bColor = b.catalogue_color_sort_order ?? b.color_position
      if (aColor !== bColor) return aColor - bColor
      return a.size_order - b.size_order
    })

  const availability: Record<string, number> = {}
  for (const r of (availRows ?? []) as { variant_id: string; available_qty: number }[]) {
    availability[r.variant_id] = r.available_qty
  }

  const catalogueImages = ((catalogueImageRows ?? []) as Array<{
    id: string
    image_url: string | null
    view: string | null
    alt_text: string | null
    position: number | null
    color_swatch_id: string | null
  }>)
    .filter((r) => r.image_url)
    .map((r) => ({
      id: `catalogue:${r.id}`,
      url: r.image_url as string,
      view: r.view,
      alt: r.alt_text,
      position: r.position,
      color_swatch_id: r.color_swatch_id,
      scope: 'catalogue' as const,
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
      view: r.view,
      alt: r.alt_text,
      position: r.position,
      color_swatch_id: r.color_swatch_id,
      scope: 'master' as const,
    }))
  const images = [...catalogueImages, ...masterImages]

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
    image_url: string | null
  } | null

  const displayProduct = {
    ...productRow,
    name: catItemForked?.name ?? productRow.name,
    description: catItemForked?.description ?? productRow.description,
    image_url: catItemForked?.image_url ?? productRow.image_url,
  }

  return (
    <ProductDetailClient
      product={{
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
        brand_name: brandName,
        category_name: categoryName,
      }}
      variants={mappedVariants}
      brackets={bracketRows}
      availability={availability}
      organizationId={context.organizationId}
      images={images}
      decorations={decorations}
    />
  )
}
