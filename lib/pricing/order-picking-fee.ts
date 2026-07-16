import { pickingFeeForGoods } from './picking-fee'

/** Accept the common free-text/code forms used by saved and one-time addresses. */
export function isNewZealandShipTo(country: string | null | undefined): boolean {
  const normalized = (typeof country === 'string' ? country : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return normalized === 'nz' || normalized === 'nzl' || normalized === 'newzealand'
}

/**
 * The NZ picking fee for a whole order. Applies to stock-on-hand orders shipping
 * to NZ; 0 otherwise (purchase orders, non-NZ, or unknown ship-to). `goodsSubtotal` is the
 * ex-GST goods total (incl. any folded decoration). Shared by the server
 * (checkout submit) AND the customer checkout summary so the figure the customer
 * sees on the review page matches the Xero draft and the Monday billing note.
 */
export function orderPickingFee(input: {
  isStockOnHand: boolean
  shipCountry: string | null | undefined
  goodsSubtotal: number
}): number {
  if (!input.isStockOnHand || !isNewZealandShipTo(input.shipCountry)) return 0
  return pickingFeeForGoods(input.goodsSubtotal)
}
