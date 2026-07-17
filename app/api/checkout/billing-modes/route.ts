import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { resolveLineBillingModes } from '@/lib/checkout/resolve-line-billing-modes'

/**
 * Bound on one request's variant list. A checkout cart never approaches this;
 * the cap exists so a hand-rolled URL cannot turn one GET into an unbounded
 * IN (...) against variant_inventory.
 */
const MAX_VARIANT_IDS = 200

/**
 * Fresh per-variant billing modes for the caller's org.
 *
 * The cart's billingMode is snapshotted on the PDP and can be days stale. Once
 * checkout renders prepaid goods at $0, a stale snapshot means quoting $17.25 on
 * an order we would invoice at $1,684.98 — so the money renders from this, never
 * from the cart.
 *
 * Org scope comes from the session, never from the query string. Uses the same
 * resolveLineBillingModes as submit, so the fresh read and the authoritative
 * read cannot diverge.
 */
export async function GET(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  const raw = new URL(request.url).searchParams.get('variant_ids') ?? ''
  const variantIds = Array.from(
    new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  )

  if (variantIds.length === 0) {
    return NextResponse.json({ modeByVariantId: {} })
  }
  if (variantIds.length > MAX_VARIANT_IDS) {
    return NextResponse.json(
      { error: `At most ${MAX_VARIANT_IDS} variant_ids per request` },
      { status: 400 },
    )
  }

  const modes = await resolveLineBillingModes(
    auth.admin,
    auth.context.organizationId,
    variantIds,
  )
  return NextResponse.json({ modeByVariantId: Object.fromEntries(modes) })
}
