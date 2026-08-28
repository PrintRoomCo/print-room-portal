import { allInUnitPrice, type CartLine } from '@/lib/cart/types'
import { pickingFeeForGoods } from './picking-fee'
import { round2 } from './pricingMath'

/**
 * Canonical SP3 picking fee. Country normalization has already happened at the
 * checkout boundary, so billing accepts only the exact ISO bill country.
 */
export function orderPickingFee(input: {
  orderType: 'purchase_order' | 'stock_on_hand'
  billCountry: string
  goodsSubtotal: number
}): number {
  // SP3 deliberate billing change: the destination partition owns this fee.
  // Therefore an AU-headquartered org shipping stock to NZ now pays the NZ fee.
  if (input.orderType !== 'stock_on_hand' || input.billCountry !== 'NZ') return 0
  return pickingFeeForGoods(input.goodsSubtotal)
}

/**
 * Flag-off compatibility only. Delete with CHECKOUT_COUNTRY_PARTITION_ENABLED.
 * This freezes the pre-SP3 fuzzy address and non-NZ-default suppression and is
 * never reached by enabled preparation. Only an NZ default country carries the
 * legacy fee; a future non-NZ default (e.g. GB) is exact-country safe: zero.
 * Null/undefined preserves the old unknown-org NZ assumption.
 */
function legacyPickingFeeWhenCountryPartitionOff(input: {
  orderType: 'purchase_order' | 'stock_on_hand'
  shipCountry: string | null | undefined
  goodsSubtotal: number
  defaultBillCountry: string | null | undefined
}): number {
  if ((input.defaultBillCountry ?? 'NZ') !== 'NZ') return 0
  const normalized = (typeof input.shipCountry === 'string' ? input.shipCountry : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  const isLegacyNz =
    normalized === 'nz' || normalized === 'nzl' || normalized === 'newzealand'
  if (input.orderType !== 'stock_on_hand' || !isLegacyNz) return 0
  return pickingFeeForGoods(input.goodsSubtotal)
}

/** Selects the frozen dark-deployment path before invoking canonical SP3 billing. */
export function checkoutPickingFee(input: {
  countryPartitionEnabled: boolean
  orderType: 'purchase_order' | 'stock_on_hand'
  billCountry: string
  goodsSubtotal: number
  legacyShipCountry: string | null | undefined
  legacyDefaultBillCountry: string | null | undefined
  /**
   * Split-shipment orders pay a per-destination split fee instead
   * (lib/pricing/split-fee.ts), which REPLACES the picking fee rather than
   * adding to it. Checked before every other gate, the legacy adapter included.
   */
  splitShipment?: boolean
}): number {
  if (input.splitShipment === true) return 0
  if (!input.countryPartitionEnabled) {
    return legacyPickingFeeWhenCountryPartitionOff({
      orderType: input.orderType,
      shipCountry: input.legacyShipCountry,
      goodsSubtotal: input.goodsSubtotal,
      defaultBillCountry: input.legacyDefaultBillCountry,
    })
  }
  return orderPickingFee({
    orderType: input.orderType,
    billCountry: input.billCountry,
    goodsSubtotal: input.goodsSubtotal,
  })
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
 * Drawer-side fee estimate. SP3 uses the organization's exact default billing
 * country until checkout knows the final ship-to; the flag-off path preserves
 * the legacy assumed-NZ destination. 0 when the cart has no stocked goods.
 */
export function estimateCartPickingFee(
  lines: CartLine[],
  options: {
    countryPartitionEnabled: boolean
    defaultBillCountry: string | null
    legacyDefaultBillCountry: string | null | undefined
  } = {
    countryPartitionEnabled: false,
    defaultBillCountry: null,
    legacyDefaultBillCountry: null,
  },
): number {
  const goods = stockedGoodsValue(lines)
  if (goods <= 0) return 0
  return checkoutPickingFee({
    countryPartitionEnabled: options.countryPartitionEnabled,
    orderType: 'stock_on_hand',
    billCountry: options.defaultBillCountry ?? '',
    goodsSubtotal: goods,
    // The legacy drawer always assumed an NZ destination because it did not yet
    // know the final ship-to; only a non-NZ default country could suppress it.
    legacyShipCountry: 'NZ',
    legacyDefaultBillCountry: options.legacyDefaultBillCountry,
  })
}
