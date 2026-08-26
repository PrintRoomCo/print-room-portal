// lib/starshipit/eligibility.ts
//
// Push-eligibility for the portal → Starshipit create-order (dark by default).
// Mirrors the shape of lib/xero/eligibility.ts. The `trigger` axis decides
// whether the stock gate applies: placement pushes stock orders only, while
// production_complete (Monday "All Production Complete") pushes made-to-order.
//
// NOTE on `orderType`: this is a DELIVERY vs PICKUP discriminator, NOT Spec A's
// order_type (which is 'stock_on_hand' | 'purchase_order' — a stock/production
// axis). The portal has no pickup concept today, so the orchestrator passes null
// here; `intent === 'customer'` is the real ship-to-customer signal.

/** Which event initiated the push — decides whether the stock gate applies. */
export type StarshipitPushTrigger = 'placement' | 'production_complete'

export type StarshipitIneligibleReason =
  | 'disabled'
  | 'test_org'
  | 'inventory_intent'
  | 'already_pushed'
  | 'not_stock_on_hand'
  | 'non_delivery_type'
  | 'no_address'
  | 'au_region'
export type StarshipitEligibilityReason = 'ok' | StarshipitIneligibleReason

export interface StarshipitEligibilityInput {
  /** isStarshipitEnabled() result. */
  enabled: boolean
  /** placement = checkout step 5d (stock gate applies); production_complete =
   *  Monday "All Production Complete" bridge (stock gate does NOT apply). */
  trigger: StarshipitPushTrigger
  /** Order-level checkout intent — 'inventory' orders never ship to a customer. */
  intent: 'customer' | 'inventory'
  isTestOrg: boolean
  /** orders.starshipit_pushed_at already set — D6 idempotency guard. */
  alreadyPushed: boolean
  /** Spec A order_type gate — at PLACEMENT Starshipit takes stock orders only.
   *  A purchase-order ships later via the production_complete trigger. */
  isStockOnHand: boolean
  hasDeliveryAddress: boolean
  /** Optional delivery/pickup discriminator (NOT Spec A order_type). */
  orderType?: string | null
  /** Immutable quote billing stamp (org default country for historical NULL
   *  quotes). AU-billed orders skip Starshipit entirely (no AU account; AU
   *  freight is Tier 2+). Null/unknown = NZ. */
  billCountry: string | null | undefined
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
  // The externally observed reason string 'au_region' is stable audit history;
  // the gate itself reads the bill-country stamp, not an organization column.
  if ((input.billCountry ?? 'NZ') === 'AU') return { eligible: false, reason: 'au_region' }
  if (input.intent === 'inventory') return { eligible: false, reason: 'inventory_intent' }
  if (input.alreadyPushed) return { eligible: false, reason: 'already_pushed' }
  if (input.trigger === 'placement' && !input.isStockOnHand)
    return { eligible: false, reason: 'not_stock_on_hand' }
  if (input.orderType != null && input.orderType !== 'delivery')
    return { eligible: false, reason: 'non_delivery_type' }
  if (!input.hasDeliveryAddress) return { eligible: false, reason: 'no_address' }
  return { eligible: true, reason: 'ok' }
}
