import { pickingFeeForGoods } from './picking-fee'

/**
 * Region seam: the NZD picking fee applies to NZ ship-to orders only. AUS
 * billing (AUD + 10% GST) is deferred to its own multi-currency epic, so AUS
 * ship-to orders are excluded from the fee for now. `country` is the free-text
 * ship-to country (store or custom address) — the only per-order region signal.
 */
export function isAustralianShipTo(country: string | null | undefined): boolean {
  const c = (typeof country === 'string' ? country : '').trim().toLowerCase()
  return c === 'au' || c === 'aus' || c.startsWith('austral')
}

/**
 * The NZ picking fee for a whole order. Applies to stock-on-hand orders shipping
 * to NZ; 0 otherwise (purchase orders, or AUS ship-to). `goodsSubtotal` is the
 * ex-GST goods total (incl. any folded decoration). Shared by the server
 * (checkout submit) AND the customer checkout summary so the figure the customer
 * sees on the review page matches the Xero draft and the Monday billing note.
 */
export function orderPickingFee(input: {
  isStockOnHand: boolean
  shipCountry: string | null | undefined
  goodsSubtotal: number
}): number {
  if (!input.isStockOnHand || isAustralianShipTo(input.shipCountry)) return 0
  return pickingFeeForGoods(input.goodsSubtotal)
}
