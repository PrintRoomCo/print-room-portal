// $500 minimum order value on customer purchase orders.
// Design: docs/superpowers/specs/2026-08-27-purchase-order-minimum-value-design.md
//
// Pure by design: no I/O, no Supabase. The cart hint, the checkout meter and the
// submit backstop all call evaluateMinimumOrder, so they cannot disagree about
// the policy — and the whole rule is unit-testable without a database.
import type { OrderType } from '@/lib/orders/order-type'
import { round2 } from '@/lib/pricing/pricingMath'

/**
 * Applied in each partition's OWN billing currency — NZD 500, AUD 500. There is
 * deliberately no FX conversion: the number a customer is quoted is the number
 * they are measured against.
 */
export const PURCHASE_ORDER_MINIMUM = 500

export interface MinimumOrderExemptions {
  /** organizations.min_order_exempt — negotiated accounts. */
  orgExempt: boolean
  /** organizations.is_test — demo/test orgs. */
  isTest: boolean
  /** Checkout `intent === 'inventory'` — an org restocking its own shelf. */
  isInventoryIntent: boolean
  /** EVERY line is an open-period pre-order item. Mixed carts are not exempt. */
  allPreOrder: boolean
}

export interface MinimumOrderStatus {
  /** False when the order is stock-on-hand or an exemption cleared it. */
  applies: boolean
  /** True when the gate does not block: !applies, or value >= threshold. */
  met: boolean
  threshold: number
  currency: string
  value: number
  /** 0 when met; otherwise threshold - value, rounded to cents. */
  shortfall: number
}

export function evaluateMinimumOrder(input: {
  orderType: OrderType
  notionalValue: number
  currency: string
  exemptions: MinimumOrderExemptions
}): MinimumOrderStatus {
  const { orderType, notionalValue, currency, exemptions } = input
  const exempt =
    exemptions.orgExempt ||
    exemptions.isTest ||
    exemptions.isInventoryIntent ||
    exemptions.allPreOrder
  const applies = orderType === 'purchase_order' && !exempt
  const value = round2(notionalValue)
  const met = !applies || value >= PURCHASE_ORDER_MINIMUM
  return {
    applies,
    met,
    threshold: PURCHASE_ORDER_MINIMUM,
    currency,
    value,
    shortfall: met ? 0 : round2(PURCHASE_ORDER_MINIMUM - value),
  }
}

/**
 * Exemption 4. Requires EVERY line to be a period item: one cheap period item
 * must not exempt an unrelated order. An empty cart, a cart with no open period,
 * and a line without catalogue identity all return false.
 */
export function allLinesArePreOrder(
  lines: ReadonlyArray<{ catalogueItemId?: string | null }>,
  preOrderItemIds: ReadonlySet<string>,
): boolean {
  if (lines.length === 0 || preOrderItemIds.size === 0) return false
  return lines.every(
    (line) => Boolean(line.catalogueItemId) && preOrderItemIds.has(line.catalogueItemId as string),
  )
}

export interface CartMinimumOrderView {
  status: MinimumOrderStatus
  /** Under the minimum, but an exemption may still apply at checkout — warn, do not block. */
  tentative: boolean
  /** Under the minimum with no exemption left to apply — safe to disable checkout. */
  blocks: boolean
}

/**
 * Cart-layer verdict. The cart is pre-partition and pre-intent, so two of the
 * four exemptions are not knowable here: `intent` is a checkout-time toggle
 * (`addToInventory`, offered to franchise and studio_plus_inventory orgs) and the
 * open period may still be loading. This function therefore degrades to a warning
 * rather than a block whenever an exemption could still land — the cart hint
 * saves a wasted trip to checkout, it is never the only thing blocking an order.
 */
export function evaluateCartMinimumOrder(input: {
  orderType: OrderType
  notionalValue: number
  currency: string
  orgExempt: boolean
  isTest: boolean
  /** The org may flip this order to an inventory restock at checkout. */
  canRouteToInventory: boolean
  /** The open-period lookup has not resolved yet. */
  periodLookupPending: boolean
  /** Cart catalogue item ids that belong to the org's open ordering period. */
  preOrderItemIdsInCart: ReadonlySet<string>
  /** Every cart line's catalogue item id, in cart order. */
  lineCatalogueItemIds: ReadonlyArray<string | null | undefined>
}): CartMinimumOrderView {
  const status = evaluateMinimumOrder({
    orderType: input.orderType,
    notionalValue: input.notionalValue,
    currency: input.currency,
    exemptions: {
      orgExempt: input.orgExempt,
      isTest: input.isTest,
      // Unknowable in the cart. Left false so the gate still evaluates; the
      // `canRouteToInventory` downgrade below is what prevents a false block.
      isInventoryIntent: false,
      allPreOrder: allLinesArePreOrder(
        input.lineCatalogueItemIds.map((catalogueItemId) => ({ catalogueItemId })),
        input.preOrderItemIdsInCart,
      ),
    },
  })
  const under = status.applies && !status.met
  const exemptionStillPossible =
    input.canRouteToInventory ||
    input.periodLookupPending ||
    input.preOrderItemIdsInCart.size > 0
  return {
    status,
    tentative: under && exemptionStillPossible,
    blocks: under && !exemptionStillPossible,
  }
}
