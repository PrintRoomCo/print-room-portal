import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin } = auth
  const { id } = await params

  const [{ data: product, error: pErr }, { data: variants }, { data: brackets }] = await Promise.all([
    admin.from('products')
      .select(
        'id, name, description, brand_id, category_id, moq, lead_time_days, sizing_type, ' +
        'decoration_eligible, decoration_price, image_url, specs, is_active, ' +
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
    decoration_eligible: boolean | null
    decoration_price: number | null
    image_url: string | null
    specs: unknown
    is_active: boolean
  }
  const productRow = product as unknown as ProductDetail | null
  if (pErr || !productRow || !productRow.is_active) {
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

  return NextResponse.json({ product: productRow, variants: mappedVariants, brackets: brackets ?? [] })
}
