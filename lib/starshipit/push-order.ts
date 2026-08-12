// lib/starshipit/push-order.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { normalizeShippingAddress } from '@/lib/checkout/shipping-address'
import { isStarshipitEnabled } from './config'
import { evaluateStarshipitEligibility, type StarshipitPushTrigger } from './eligibility'
import { createStarshipitOrder } from './client'
import { loadStarshipitOrderItems } from './items'
import { isStoreShipment, loadOrdererName, resolveStarshipitDestination } from './destination'

export interface PushOrderToStarshipitArgs {
  orderId: string
  orderRef: string
  /** quotes.id — line items live on quote_items, keyed by quote. */
  quoteId: string
  organizationId: string
  actorUserId: string | null
  /** Which event initiated this push — decides whether the stock gate applies. */
  trigger: StarshipitPushTrigger
  intent: 'customer' | 'inventory'
  isTestOrg: boolean
  /** Spec A stock/production axis — gates the PLACEMENT trigger only. */
  isStockOnHand: boolean
  customerEmail: string | null
  shippingAddress: Record<string, unknown> | null
  /**
   * Optional delivery/pickup discriminator — NOT Spec A orders.order_type
   * (which is 'stock_on_hand'|'purchase_order', a stock/production axis). The
   * portal has no pickup concept, so callers pass null; `intent` is the real
   * ship-to-customer signal.
   */
  orderType?: string | null
}

export interface PushOrderResult {
  status: 'pushed' | 'skipped'
  reason: string
  starshipitOrderId?: string
}

/**
 * Register the order in Starshipit, or skip. Idempotent via
 * orders.starshipit_pushed_at (D6): safe under Monday's at-least-once
 * redelivery. Best-effort: THROWS on a Starshipit/DB error so the caller
 * audits ORDER_STARSHIPIT_PUSH_FAILED. Never rolls back the order.
 */
export async function pushOrderToStarshipit(
  admin: SupabaseClient,
  args: PushOrderToStarshipitArgs,
): Promise<PushOrderResult> {
  // Flag first, before any DB read — keeps the path fully inert (and safe to
  // deploy before the starshipit_* columns exist) while dark.
  if (!isStarshipitEnabled()) return { status: 'skipped', reason: 'disabled' }

  const { data: orderRow, error: orderReadError } = await admin
    .from('orders')
    .select('starshipit_pushed_at')
    .eq('id', args.orderId)
    .maybeSingle()
  if (orderReadError) throw new Error(`orders read failed: ${orderReadError.message}`)
  const alreadyPushed = Boolean(
    (orderRow as { starshipit_pushed_at?: string | null } | null)?.starshipit_pushed_at,
  )

  const address = normalizeShippingAddress(args.shippingAddress)
  // Store snapshots carry the full locality in the street blob even when the
  // city column is blank, so a street alone is a shippable store address.
  // Custom (customer-typed) addresses still require city — an incomplete
  // customer address is genuinely not deliverable.
  const hasDeliveryAddress = isStoreShipment(args.shippingAddress)
    ? Boolean(address?.street)
    : Boolean(address?.street && address?.city)

  const elig = evaluateStarshipitEligibility({
    enabled: true, // flag checked above
    trigger: args.trigger,
    intent: args.intent,
    isTestOrg: args.isTestOrg,
    alreadyPushed,
    isStockOnHand: args.isStockOnHand,
    hasDeliveryAddress,
    orderType: args.orderType ?? null,
  })
  if (!elig.eligible) return { status: 'skipped', reason: elig.reason }

  // Best-effort enrichment — a failed enrichment read must never lose the push.
  // Store orders: company ← branch, name ← orderer (design A2). Gate the name
  // lookup on isStoreShipment so custom orders don't pay an extra round-trip.
  const ordererName = isStoreShipment(args.shippingAddress)
    ? await loadOrdererName(admin, args.quoteId)
    : null
  const destination = resolveStarshipitDestination({
    address: address!,
    rawAddress: args.shippingAddress,
    ordererName,
  })
  // loadStarshipitOrderItems returns [] on error (an address-only ticket still prints).
  const items = await loadStarshipitOrderItems(admin, args.quoteId)

  const starshipitOrderId = await createStarshipitOrder({
    orderNumber: args.orderRef,
    address: destination,
    customerEmail: args.customerEmail,
    items,
  })
  if (!starshipitOrderId) throw new Error('Starshipit create-order returned no order id')

  // Stamp BEFORE the audit write: if this fails we throw (caller audits the
  // failure) — the worst case is a rare duplicate queue entry staff can see,
  // never a silently-unguarded repeat path.
  const { error: stampError } = await admin
    .from('orders')
    .update({
      starshipit_pushed_at: new Date().toISOString(),
      starshipit_order_id: starshipitOrderId,
    })
    .eq('id', args.orderId)
  if (stampError) throw new Error(`starshipit stamp failed: ${stampError.message}`)

  await recordAuditEvent(
    {
      orgId: args.organizationId,
      actorUserId: args.actorUserId,
      action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSHED,
      targetType: 'order',
      targetId: args.orderId,
      metadata: {
        order_ref: args.orderRef,
        starshipit_order_id: starshipitOrderId,
        trigger: args.trigger,
      },
    },
    admin,
  )

  return { status: 'pushed', reason: 'ok', starshipitOrderId }
}
