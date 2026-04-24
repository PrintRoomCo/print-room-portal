import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function GET(request: Request) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  const p = new URL(request.url).searchParams
  const limit = Math.min(100, Math.max(1, Number(p.get('limit') ?? 24)))
  const offset = Math.max(0, Number(p.get('offset') ?? 0))

  let q = admin.from('products')
    .select(
      'id, name, sku, image_url, brand_id, category_id, moq, garment_family, ' +
      '_channel:product_type_activations!inner(product_type,is_active)',
      { count: 'exact' }
    )
    .eq('is_active', true)
    .eq('_channel.product_type', 'b2b')
    .eq('_channel.is_active', true)
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1)

  const search = p.get('q')
  if (search) q = q.ilike('name', `%${search}%`)
  const brandId = p.get('brand_id')
  if (brandId) q = q.eq('brand_id', brandId)
  const categoryId = p.get('category_id')
  if (categoryId) q = q.eq('category_id', categoryId)
  const garmentFamily = p.get('garment_family')
  if (garmentFamily) q = q.eq('garment_family', garmentFamily)

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ products: [], total: 0, limit, offset })

  interface ProductRow {
    id: string
    name: string
    sku: string | null
    image_url: string | null
    brand_id: string
    category_id: string
    moq: number | null
    garment_family: string | null
  }

  const rows = data as unknown as ProductRow[]
  const results = await Promise.all(rows.map(async (prod) => {
    const moq = prod.moq ?? 1
    const { data: price } = await admin.rpc('get_unit_price', {
      p_product_id: prod.id,
      p_org_id: context.organizationId,
      p_qty: moq || 1,
    })

    const { data: variants } = await admin
      .from('product_variants')
      .select('id')
      .eq('product_id', prod.id)
    const variantIds = (variants ?? []).map((v) => v.id)

    let has_stock = false
    if (variantIds.length) {
      const { data: stocked } = await admin
        .from('variant_availability')
        .select('variant_id')
        .eq('organization_id', context.organizationId)
        .gt('available_qty', 0)
        .in('variant_id', variantIds)
        .limit(1)
      has_stock = (stocked?.length ?? 0) > 0
    }

    return {
      id: prod.id,
      name: prod.name,
      sku: prod.sku,
      image_url: prod.image_url,
      brand_id: prod.brand_id,
      category_id: prod.category_id,
      from_unit_price: Number(price ?? 0),
      has_stock,
    }
  }))

  return NextResponse.json({ products: results, total: count ?? 0, limit, offset })
}
