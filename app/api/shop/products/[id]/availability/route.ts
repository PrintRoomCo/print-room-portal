import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth
  const { id: productId } = await params

  const { data: variants } = await admin
    .from('product_variants')
    .select('id')
    .eq('product_id', productId)
  const variantIds = (variants ?? []).map((v) => v.id)
  if (!variantIds.length) return NextResponse.json({ availability: {} })

  const { data: rows } = await admin
    .from('variant_availability')
    .select('variant_id, available_qty')
    .eq('organization_id', context.organizationId)
    .in('variant_id', variantIds)

  const availability: Record<string, number> = {}
  for (const r of rows ?? []) availability[r.variant_id] = r.available_qty
  return NextResponse.json({ availability })
}
