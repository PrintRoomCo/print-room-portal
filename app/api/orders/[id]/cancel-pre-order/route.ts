import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { cacheTags } from '@/lib/cache/tags'
import { deleteStarshipitOrderOnCancel } from '@/lib/starshipit/delete-on-cancel'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params

  // 1. Resolve caller + org membership — identical pattern to
  //    app/api/proofs/[id]/amendment-requests/route.ts (the canonical sibling).
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  const userId = context.userId
  const orgId = context.organizationId
  const role = context.role

  // 2. Load order + its quote. Enforce org ownership and window state.
  const { data: order } = await admin
    .from('orders')
    .select('id, status, period_id, quote_id, quotes ( organization_id, created_by )')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const quote = Array.isArray(order.quotes) ? order.quotes[0] : order.quotes
  if (quote?.organization_id !== orgId)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  if (order.status !== 'awaiting-period-close')
    return NextResponse.json({ error: 'not_cancellable' }, { status: 409 })

  // staff members may only cancel their own order; org_admin any org order.
  if (role !== 'org_admin' && quote?.created_by !== userId)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // 3. Customers may only cancel while the window is still open.
  const { data: period } = await admin
    .from('b2b_ordering_periods')
    .select('status')
    .eq('id', order.period_id)
    .maybeSingle()

  if (period?.status !== 'open')
    return NextResponse.json({ error: 'window_closed' }, { status: 409 })

  const { error } = await admin.rpc('cancel_pre_order_order', {
    p_order_id: orderId,
    p_reason: 'customer_cancel_before_close',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort: pull the cancelled order back out of the Starshipit print
  // queue (design D7/P3). Never throws; no-op while STARSHIPIT_ENABLED unset
  // or when the order was never pushed.
  await deleteStarshipitOrderOnCancel(admin, { orderId, organizationId: orgId })

  revalidateTag(cacheTags.orderTracker, { expire: 0 })

  return NextResponse.json({ ok: true })
}
