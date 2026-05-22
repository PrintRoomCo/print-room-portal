import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { createReorderRequest } from '@/lib/checkout/reorder-request'
import { cacheTags } from '@/lib/cache/tags'

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  let body: { variant_id?: string; requested_qty?: number; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (
    !body.variant_id ||
    !body.requested_qty ||
    !Number.isInteger(body.requested_qty) ||
    body.requested_qty <= 0
  ) {
    return NextResponse.json(
      { error: 'variant_id + positive integer requested_qty required' },
      { status: 400 }
    )
  }

  try {
    const row = await createReorderRequest(auth.admin, auth.context, {
      variant_id: body.variant_id,
      requested_qty: body.requested_qty,
      note: body.note,
    })
    // New reorder request → quotes/orders surfaces stale.
    revalidateTag(cacheTags.accountData, { expire: 0 })
    revalidateTag(cacheTags.orderTracker, { expire: 0 })
    return NextResponse.json({ ok: true, id: row.id })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
