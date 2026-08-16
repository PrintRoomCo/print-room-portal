import { allInUnitPrice, type CartLine } from '@/lib/cart/types'
import { pickingFeeForGoods } from './picking-fee'
import { round2 } from './pricingMath'

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
  /** organizations.region — an AU org NEVER pays the NZ picking fee, even when
   *  shipping to NZ (the fee is NZD; the order bills AUD). Null/unknown = NZ.
   *  Required so no caller can silently skip the gate. */
  orgRegion: string | null | undefined
}): number {
  if ((input.orgRegion ?? 'NZ') === 'AU') return 0
  if (!input.isStockOnHand || !isNewZealandShipTo(input.shipCountry)) return 0
  return pickingFeeForGoods(input.goodsSubtotal)
}

/**
 * Goods value of the cart's STOCKED lines — the drawer-side picking-fee band
 * basis. Mirrors order-billing-shape's goodsValueForBand: full all-in value,
 * per-line rounding then a rounded sum; lines without a fulfilmentType submit
 * as purchase orders, so they are excluded here too.
 */
export function stockedGoodsValue(lines: CartLine[]): number {
  return round2(
    lines
      .filter((line) => line.fulfilmentType === 'stocked')
      .reduce((total, line) => total + round2(line.qty * allInUnitPrice(line)), 0),
  )
}

/**
 * Drawer-side fee estimate. Assumes an NZ ship-to (the drawer cannot know the
 * address yet; checkout recomputes with the real one). 0 when the cart has no
 * stocked goods — the drawer then shows no fee row.
 */
export function estimateCartPickingFee(lines: CartLine[], orgRegion?: string | null): number {
  if ((orgRegion ?? 'NZ') === 'AU') return 0
  const goods = stockedGoodsValue(lines)
  if (goods <= 0) return 0
  return pickingFeeForGoods(goods)
}
