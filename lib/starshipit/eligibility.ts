// lib/starshipit/eligibility.ts
//
// Push-eligibility for the portal → Starshipit create-order (dark by default).
// Mirrors the shape of lib/xero/eligibility.ts.
//
// NOTE on `orderType`: this is a DELIVERY vs PICKUP discriminator, NOT Spec A's
// order_type (which is 'stock_on_hand' | 'purchase_order' — a stock/production
// axis). The portal has no pickup concept today, so the orchestrator passes null
// here; `intent === 'customer'` is the real ship-to-customer signal.

export type StarshipitIneligibleReason =
  | 'disabled'
  | 'test_org'
  | 'inventory_intent'
  | 'not_stock_on_hand'
  | 'non_delivery_type'
  | 'no_address'
export type StarshipitEligibilityReason = 'ok' | StarshipitIneligibleReason

export interface StarshipitEligibilityInput {
  /** isStarshipitEnabled() result. */
  enabled: boolean
  /** Order-level checkout intent — 'inventory' orders never ship to a customer. */
  intent: 'customer' | 'inventory'
  isTestOrg: boolean
  /** Spec A order_type gate — Starshipit dispatches STOCK orders only. A
   *  purchase-order (any made-to-order line) ships via the production flow. */
  isStockOnHand: boolean
  hasDeliveryAddress: boolean
  /** Optional delivery/pickup discriminator (NOT Spec A order_type). */
  orderType?: string | null
}

export interface StarshipitEligibility {
  eligible: boolean
  reason: StarshipitEligibilityReason
}

export function evaluateStarshipitEligibility(
  input: StarshipitEligibilityInput,
): StarshipitEligibility {
  if (!input.enabled) return { eligible: false, reason: 'disabled' }
  if (input.isTestOrg) return { eligible: false, reason: 'test_org' }
  if (input.intent === 'inventory') return { eligible: false, reason: 'inventory_intent' }
  if (!input.isStockOnHand) return { eligible: false, reason: 'not_stock_on_hand' }
  if (input.orderType != null && input.orderType !== 'delivery')
    return { eligible: false, reason: 'non_delivery_type' }
  if (!input.hasDeliveryAddress) return { eligible: false, reason: 'no_address' }
  return { eligible: true, reason: 'ok' }
}
