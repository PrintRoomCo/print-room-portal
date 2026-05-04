import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { effectiveUnitPrice } from '@/lib/shop/effective-price'

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

  // Canonical pricing per project_b2b_pricing_canonical.md — never call
  // get_unit_price directly: it bypasses catalogue scope and returns 0.00 for
  // catalogue products without master pricing tiers.
  const [result, { data: bracket }] = await Promise.all([
    effectiveUnitPrice(admin, body.product_id, context.organizationId, body.qty),
    admin
      .from('product_pricing_tiers')
      .select('min_quantity, max_quantity')
      .eq('product_id', body.product_id)
      .eq('is_active', true)
      .lte('min_quantity', body.qty)
      .order('min_quantity', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    unit_price: result.unitPrice,
    total: Number((result.unitPrice * body.qty).toFixed(2)),
    status: result.status,
    bracket: bracket ?? null,
  })
}
