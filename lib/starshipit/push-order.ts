// lib/starshipit/push-order.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { normalizeShippingAddress } from '@/lib/checkout/shipping-address'
import { isStarshipitEnabled } from './config'
import { evaluateStarshipitEligibility } from './eligibility'
import { createStarshipitOrder } from './client'

export interface PushOrderToStarshipitArgs {
  orderId: string
  orderRef: string
  organizationId: string
  actorUserId: string | null
  intent: 'customer' | 'inventory'
  isTestOrg: boolean
  /** Spec A stock/production axis — Starshipit dispatches stock orders only. */
  isStockOnHand: boolean
  customerEmail: string | null
  shippingAddress: Record<string, unknown> | null
  /**
   * Optional delivery/pickup discriminator — NOT Spec A orders.order_type
   * (which is 'stock_on_hand'|'purchase_order', a stock/production axis). The
   * portal has no pickup concept, so submit passes null; `intent` is the real
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
 * Register the order in Starshipit at placement, or skip. Best-effort: THROWS
 * on a Starshipit/DB error so the caller (submit.ts step 5d) audits
 * ORDER_STARSHIPIT_PUSH_FAILED. Never rolls back the order — mirrors
 * createDraftInvoiceForOrder.
 */
export async function pushOrderToStarshipit(
  admin: SupabaseClient,
  args: PushOrderToStarshipitArgs,
): Promise<PushOrderResult> {
  const address = normalizeShippingAddress(args.shippingAddress)
  const hasDeliveryAddress = Boolean(address?.street && address?.city)

  const elig = evaluateStarshipitEligibility({
    enabled: isStarshipitEnabled(),
    intent: args.intent,
    isTestOrg: args.isTestOrg,
    isStockOnHand: args.isStockOnHand,
    hasDeliveryAddress,
    orderType: args.orderType ?? null,
  })
  if (!elig.eligible) return { status: 'skipped', reason: elig.reason }

  const starshipitOrderId = await createStarshipitOrder({
    orderNumber: args.orderRef,
    address: address!,
    customerEmail: args.customerEmail,
  })
  if (!starshipitOrderId) throw new Error('Starshipit create-order returned no order id')

  await recordAuditEvent(
    {
      orgId: args.organizationId,
      actorUserId: args.actorUserId,
      action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSHED,
      targetType: 'order',
      targetId: args.orderId,
      metadata: { order_ref: args.orderRef, starshipit_order_id: starshipitOrderId },
    },
    admin,
  )

  return { status: 'pushed', reason: 'ok', starshipitOrderId }
}
