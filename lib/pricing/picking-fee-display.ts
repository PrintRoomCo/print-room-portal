import { PICKING_FEE_BANDS } from './picking-fee'

export interface PickingFeeBandRow {
  /** Inclusive display range, e.g. "$0 – $99" or "$400+". */
  range: string
  fee: number
}

/**
 * Display rows derived from PICKING_FEE_BANDS so the tooltip can never
 * drift from the bands the fee is actually charged on.
 */
export function pickingFeeBandRows(): PickingFeeBandRow[] {
  let start = 0
  return PICKING_FEE_BANDS.map((band) => {
    const range =
      band.maxExclusive === Infinity
        ? `$${start}+`
        : `$${start} – $${band.maxExclusive - 1}`
    const row = { range, fee: band.fee }
    start = band.maxExclusive
    return row
  })
}

/** Index into PICKING_FEE_BANDS for a goods subtotal. Mirrors pickingFeeForGoods clamping. */
export function activeBandIndex(goodsSubtotal: number): number {
  const g = Number.isFinite(goodsSubtotal) ? Math.max(0, goodsSubtotal) : 0
  const index = PICKING_FEE_BANDS.findIndex((band) => g < band.maxExclusive)
  return index === -1 ? PICKING_FEE_BANDS.length - 1 : index
}
