import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { getEffectiveMoq } from '@/lib/shop/effective-moq'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth
  const { id: productId } = await params

  // Resolve customer-effective MOQ for the cart UI in parallel with the
  // variant availability lookup. The cart polls /availability on mount, so
  // piggy-backing avoids a second round-trip per product.
  const grantedItemIdsPromise = getGrantedCatalogueItemIds(
    admin,
    context.membershipId,
    context.organizationId,
  )

  const variantsPromise = admin
    .from('product_variants')
    .select('id')
    .eq('product_id', productId)

  const productPromise = admin
    .from('products')
    .select('moq')
    .eq('id', productId)
    .maybeSingle()

  const [{ data: variants }, { data: productRow }, grantedItemIds] = await Promise.all([
    variantsPromise,
    productPromise,
    grantedItemIdsPromise,
  ])

  let effectiveMoq = getEffectiveMoq(
    productRow as { moq: number | null } | null ?? { moq: null },
    null,
  )
  if (grantedItemIds.length > 0) {
    const { data: catItem } = await admin
      .from('b2b_catalogue_items')
      .select('moq_override')
      .eq('source_product_id', productId)
      .eq('is_active', true)
      .in('id', grantedItemIds)
      .limit(1)
      .maybeSingle()
    effectiveMoq = getEffectiveMoq(
      productRow as { moq: number | null } | null ?? { moq: null },
      catItem as { moq_override: number | null } | null,
    )
  }

  const variantIds = (variants ?? []).map((v) => v.id)
  if (!variantIds.length) {
    return NextResponse.json({ availability: {}, effectiveMoq })
  }

  const { data: rows } = await admin
    .from('variant_availability')
    .select('variant_id, available_qty')
    .eq('organization_id', context.organizationId)
    .in('variant_id', variantIds)

  const availability: Record<string, number> = {}
  for (const r of rows ?? []) availability[r.variant_id] = r.available_qty
  return NextResponse.json({ availability, effectiveMoq })
}
