import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function POST(request: Request) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  let body: { product_id?: string; qty?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (
    !body.product_id ||
    !body.qty ||
    !Number.isInteger(body.qty) ||
    body.qty <= 0
  ) {
    return NextResponse.json(
      { error: 'product_id and positive integer qty required' },
      { status: 400 }
    )
  }

  const [{ data: price }, { data: bracket }] = await Promise.all([
    admin.rpc('get_unit_price', {
      p_product_id: body.product_id,
      p_org_id: context.organizationId,
      p_qty: body.qty,
    }),
    admin.from('product_pricing_tiers')
      .select('min_quantity, max_quantity')
      .eq('product_id', body.product_id)
      .eq('is_active', true)
      .lte('min_quantity', body.qty)
      .order('min_quantity', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const unit = Number(price ?? 0)
  return NextResponse.json({
    unit_price: unit,
    total: Number((unit * body.qty).toFixed(2)),
    bracket: bracket ?? null,
  })
}
