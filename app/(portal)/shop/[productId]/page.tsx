import { notFound } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { ProductDetailClient } from '@/components/shop/ProductDetailClient'

export const dynamic = 'force-dynamic'

interface ProductDetail {
  id: string
  name: string
  description: string | null
  image_url: string | null
  moq: number | null
  lead_time_days: number | null
  sizing_type: string | null
  decoration_eligible: boolean | null
  decoration_price: number | null
  is_active: boolean
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
  if ('error' in auth) return notFound()
  const { admin, context } = auth

  const { data: catItem } = await admin
    .from('b2b_catalogue_items')
    .select('id, b2b_catalogues!inner(is_active)')
    .eq('source_product_id', productId)
    .eq('is_active', true)
    .eq('b2b_catalogues.organization_id', context.organizationId)
    .eq('b2b_catalogues.is_active', true)
    .limit(1)
    .maybeSingle()

  const productSelect = catItem
    ? 'id, name, description, image_url, moq, lead_time_days, sizing_type, decoration_eligible, decoration_price, is_active'
    : 'id, name, description, image_url, moq, lead_time_days, sizing_type, decoration_eligible, decoration_price, is_active, _channel:product_type_activations!inner(product_type,is_active)'

  const productQuery = catItem
    ? admin.from('products').select(productSelect).eq('id', productId).single()
    : admin
        .from('products')
        .select(productSelect)
        .eq('id', productId)
        .eq('_channel.product_type', 'b2b')
        .eq('_channel.is_active', true)
        .single()

  const bracketsQuery = catItem
    ? admin.from('b2b_catalogue_item_pricing_tiers')
        .select('min_quantity, max_quantity, unit_price')
        .eq('catalogue_item_id', catItem.id)
        .order('min_quantity')
    : admin.from('product_pricing_tiers')
        .select('min_quantity, max_quantity, unit_price')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('min_quantity')

  const [{ data: product }, { data: variants }, { data: brackets }, { data: availRows }] =
    await Promise.all([
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
    ])

  const productRow = product as unknown as ProductDetail | null
  if (!productRow || !productRow.is_active) return notFound()

  const variantRows = (variants ?? []) as unknown as RawVariant[]
  const mappedVariants = variantRows.map((v) => {
    const swatch = pickOne(v.product_color_swatches)
    const size = pickOne(v.sizes)
    return {
      variant_id: v.id,
      color_swatch_id: v.color_swatch_id,
      color_label: swatch?.label ?? null,
      color_hex: swatch?.hex ?? null,
      color_position: swatch?.position ?? 0,
      size_id: v.size_id,
      size_label: size?.label ?? null,
      size_order: size?.order_index ?? 0,
    }
  })

  const availability: Record<string, number> = {}
  for (const r of (availRows ?? []) as { variant_id: string; available_qty: number }[]) {
    availability[r.variant_id] = r.available_qty
  }

  const bracketRows = (brackets ?? []) as {
    min_quantity: number
    max_quantity: number | null
    unit_price: number
  }[]

  return (
    <ProductDetailClient
      product={{
        id: productRow.id,
        name: productRow.name,
        description: productRow.description,
        image_url: productRow.image_url,
        moq: productRow.moq,
        lead_time_days: productRow.lead_time_days,
        sizing_type: productRow.sizing_type,
        decoration_eligible: productRow.decoration_eligible,
        decoration_price: productRow.decoration_price,
      }}
      variants={mappedVariants}
      brackets={bracketRows}
      availability={availability}
      organizationId={context.organizationId}
    />
  )
}
