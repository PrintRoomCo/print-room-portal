import Link from 'next/link'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { effectiveUnitPricesBulk } from '@/lib/shop/effective-price'
import { ProductCard } from '@/components/shop/ProductCard'
import { getTierLabel } from '@/lib/pricing/tier-labels'
import { TierBadge } from '@/components/pricing/TierBadge'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { FilterRail } from '@/components/shop/FilterRail'
import { FilterSheetTrigger } from '@/components/shop/FilterSheetTrigger'
import { parseShopFilters, activeFilterCount } from '@/lib/shop/filter-params'
import { getShopFacets } from '@/lib/shop/facets'
import { pickCatalogueItemThumbnail, type CatalogueItemImageRow } from '@/lib/shop/catalogue-images'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import type { PricingMode } from '@/lib/pricing/types'

export const dynamic = 'force-dynamic'

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

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const filters = parseShopFilters(sp)
  const auth = await requireB2BCustomer()
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
  const scopedProductIds = Array.from(new Set(catItemRows.map((r) => r.source_product_id)))
  const productIdByItemId = new Map(catItemRows.map((r) => [r.id, r.source_product_id]))

  if (scopedProductIds.length === 0) {
    return (
      <div className="space-y-6 p-4 md:p-8">
        <PortalEmptyState
          title="Your catalogue is being set up"
          body="Your account manager will let you know when products are ready for ordering."
          actionHref="mailto:sales@theprint-room.co.nz"
          actionLabel="Contact sales"
        />
      </div>
    )
  }

  const tierLabel = getTierLabel(context.tierLevel)
  const pricingMode: PricingMode = 'catalogue'

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

  const [{ data: productData }, facets] = await Promise.all([
    q,
    getShopFacets(admin, scopedProductIds),
  ])

  const rows = (productData ?? []) as unknown as ProductRow[]

  const productIds = rows.map((r) => r.id)
  const qtyByProduct: Record<string, number> = Object.fromEntries(
    rows.map((r) => [r.id, r.moq ?? 1]),
  )
  const scopedItemIds = catItemRows
    .filter((r) => productIds.includes(r.source_product_id))
    .map((r) => r.id)
  const [{ prices }, { data: catalogueImageRows }] = await Promise.all([
    effectiveUnitPricesBulk(admin, productIds, context.organizationId, qtyByProduct),
    scopedItemIds.length > 0
      ? admin
          .from('b2b_catalogue_item_images')
          .select('catalogue_item_id, view, source, position, image_url, color_swatch_id')
          .in('catalogue_item_id', scopedItemIds)
      : Promise.resolve({ data: [] as CatalogueItemImageRow[] }),
  ])

  const imagesByProduct = new Map<string, CatalogueItemImageRow[]>()
  for (const row of (catalogueImageRows ?? []) as CatalogueItemImageRow[]) {
    const productId = productIdByItemId.get(row.catalogue_item_id)
    if (!productId) continue
    const list = imagesByProduct.get(productId) ?? []
    list.push(row)
    imagesByProduct.set(productId, list)
  }

  const products = rows.map((p) => {
    const price = prices.get(p.id) ?? { unitPrice: 0, status: 'missing' as const, hasStock: false }
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      image_url: pickCatalogueItemThumbnail(p.image_url, imagesByProduct.get(p.id) ?? []),
      from_unit_price: price.unitPrice,
      price_status: price.status,
      has_stock: price.hasStock,
    }
  })

  const activeCount = activeFilterCount(filters)

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[280px_1fr] md:gap-6 md:p-8">
      <div className="md:hidden">
        <FilterSheetTrigger activeCount={activeCount}>
          <FilterRail filters={filters} facets={facets} basePath="/catalogue" />
        </FilterSheetTrigger>
      </div>
      <div className="hidden md:block">
        <FilterRail filters={filters} facets={facets} basePath="/catalogue" />
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Customer catalogue
                </p>
                <TierBadge label={tierLabel} pricingMode={pricingMode} />
              </div>
              <h1 className="mt-2 text-2xl font-semibold text-gray-900">Catalogue</h1>
              <p className="mt-1 text-sm text-gray-600">
                Products and prices are scoped to your dedicated catalogue.
              </p>
            </div>
            <p className="text-sm text-gray-500">
              {products.length} product{products.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {products.length === 0 ? (
          <PortalEmptyState
            title="No products match your filters"
            body="Try clearing some filters."
            actionHref="/catalogue"
            actionLabel="Clear filters"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <Link key={p.id} href={`/catalogue/${p.id}`} className="block">
                <ProductCard product={p} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
