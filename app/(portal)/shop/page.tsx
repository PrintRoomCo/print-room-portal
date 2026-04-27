import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { effectiveUnitPrice } from '@/lib/shop/effective-price'
import { ProductCard } from '@/components/shop/ProductCard'

export const dynamic = 'force-dynamic'

interface ProductRow {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  brand_id: string
  category_id: string
  moq: number | null
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand_id?: string; page?: string }>
}) {
  const sp = await searchParams
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { admin, context } = auth

  const limit = 24
  const page = Math.max(1, Number(sp.page ?? 1))
  const offset = (page - 1) * limit

  // 1. Collect product ids in this org's active catalogues.
  const { data: catItems } = await admin
    .from('b2b_catalogue_items')
    .select('source_product_id, b2b_catalogues!inner(is_active)')
    .eq('b2b_catalogues.organization_id', context.organizationId)
    .eq('b2b_catalogues.is_active', true)
    .eq('is_active', true)

  const scopedProductIds = Array.from(
    new Set((catItems ?? []).map((r) => r.source_product_id as string)),
  )
  const hasCatalogueScope = scopedProductIds.length > 0

  let q = hasCatalogueScope
    ? admin.from('products')
        .select('id, name, sku, image_url, brand_id, category_id, moq', { count: 'exact' })
        .eq('is_active', true)
        .in('id', scopedProductIds)
        .order('name')
        .range(offset, offset + limit - 1)
    : admin.from('products')
        .select(
          'id, name, sku, image_url, brand_id, category_id, moq, ' +
          '_channel:product_type_activations!inner(product_type,is_active)',
          { count: 'exact' }
        )
        .eq('is_active', true)
        .eq('_channel.product_type', 'b2b')
        .eq('_channel.is_active', true)
        .order('name')
        .range(offset, offset + limit - 1)

  if (sp.q) q = q.ilike('name', `%${sp.q}%`)
  if (sp.brand_id) q = q.eq('brand_id', sp.brand_id)

  const { data } = await q
  const rows = (data ?? []) as unknown as ProductRow[]

  const products = await Promise.all(rows.map(async (p) => {
    const moqQty = p.moq ?? 1
    const price = await effectiveUnitPrice(
      admin,
      p.id,
      context.organizationId,
      moqQty || 1,
    )

    const { data: variants } = await admin
      .from('product_variants')
      .select('id')
      .eq('product_id', p.id)
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
      id: p.id,
      name: p.name,
      sku: p.sku,
      image_url: p.image_url,
      from_unit_price: price,
      has_stock,
    }
  }))

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Catalog</h1>
        <p className="text-sm text-gray-500">
          {products.length} product{products.length === 1 ? '' : 's'}
        </p>
      </div>

      {products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500">
          No products available for your account yet — contact us at{' '}
          <a className="underline" href="mailto:sales@theprint-room.co.nz">sales@theprint-room.co.nz</a>.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <Link key={p.id} href={`/shop/${p.id}`} className="block">
              <ProductCard product={p} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
