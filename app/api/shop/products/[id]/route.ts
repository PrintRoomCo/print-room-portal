import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth
  const { id } = await params

  const [{ data: catalogueItem }, { data: product, error: pErr }, { data: variants }, { data: brackets }] = await Promise.all([
    admin.from('b2b_catalogue_items')
      .select('id, name, description, image_url, decoration_method, decoration_price, b2b_catalogues!inner(is_active)')
      .eq('source_product_id', id)
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', context.organizationId)
      .eq('b2b_catalogues.is_active', true)
      .limit(1)
      .maybeSingle(),
    admin.from('products')
      .select(
        'id, name, description, brand_id, category_id, moq, lead_time_days, sizing_type, ' +
        'decoration_methods, decoration_price, image_url, specs, is_active, ' +
        '_channel:product_type_activations!inner(product_type,is_active)'
      )
      .eq('id', id)
      .eq('_channel.product_type', 'b2b')
      .eq('_channel.is_active', true)
      .single(),
    admin.from('product_variants')
      .select(`
        id, color_swatch_id, size_id,
        product_color_swatches (label, hex, position),
        sizes (label, order_index)
      `)
      .eq('product_id', id)
      .eq('is_active', true),
    admin.from('product_pricing_tiers')
      .select('min_quantity, max_quantity, unit_price')
      .eq('product_id', id)
      .eq('is_active', true)
      .order('min_quantity', { ascending: true }),
  ])

  interface ProductDetail {
    id: string
    name: string
    description: string | null
    brand_id: string
    category_id: string
    moq: number | null
    lead_time_days: number | null
    sizing_type: string | null
    decoration_methods: string[] | null
    decoration_price: number | null
    image_url: string | null
    specs: unknown
    is_active: boolean
  }
  const productRow = product as unknown as ProductDetail | null
  if (!catalogueItem || pErr || !productRow || !productRow.is_active) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  interface VariantRow {
    id: string
    color_swatch_id: string | null
    size_id: number | null
    // supabase-js types many-to-one embeds as arrays regardless of cardinality —
    // in practice PostgREST returns a single object here. Handle both defensively.
    product_color_swatches:
      | { label: string | null; hex: string | null; position: number | null }
      | { label: string | null; hex: string | null; position: number | null }[]
      | null
    sizes:
      | { label: string | null; order_index: number | null }
      | { label: string | null; order_index: number | null }[]
      | null
  }
  const variantRows = (variants ?? []) as unknown as VariantRow[]
  const pickOne = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v

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

  const catItem = catalogueItem as {
    decoration_price: number | string | null
    decoration_method: string | null
    name: string
    description: string | null
    image_url: string | null
  } | null

  const decorationPrice =
    catItem?.decoration_price != null
      ? Number(catItem.decoration_price)
      : (productRow.decoration_price ?? 0)

  return NextResponse.json({
    product: {
      ...productRow,
      name: catItem?.name ?? productRow.name,
      description: catItem?.description ?? productRow.description,
      image_url: catItem?.image_url ?? productRow.image_url,
      decoration_method: catItem?.decoration_method ?? null,
      decoration_price: decorationPrice,
    },
    variants: mappedVariants,
    brackets: brackets ?? [],
  })
}
