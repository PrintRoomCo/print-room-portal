/**
 * NZ picking-fee band table. Keyed on goods subtotal (ex-GST, NZD).
 * $0-99 = $35, $100-199 = $30, $200-299 = $25, $300-399 = $20, $400+ = $15.
 * NZD-only in v1: the caller (submit.ts step 5c) gates this to NZ ship-to orders;
 * AUS billing (AUD + 10% GST) is deferred to its own multi-currency epic.
 */
export const PICKING_FEE_BANDS: ReadonlyArray<{ maxExclusive: number; fee: number }> = [
  { maxExclusive: 100, fee: 35 },
  { maxExclusive: 200, fee: 30 },
  { maxExclusive: 300, fee: 25 },
  { maxExclusive: 400, fee: 20 },
  { maxExclusive: Infinity, fee: 15 },
]

export function pickingFeeForGoods(goodsSubtotalNzd: number): number {
  const g = Number.isFinite(goodsSubtotalNzd) ? Math.max(0, goodsSubtotalNzd) : 0
  for (const band of PICKING_FEE_BANDS) {
    if (g < band.maxExclusive) return band.fee
  }
  return PICKING_FEE_BANDS[PICKING_FEE_BANDS.length - 1].fee
}
