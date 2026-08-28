import type { CheckoutLineInput } from '@/lib/checkout/submit'

/**
 * Per-destination split-shipment fee band table, keyed on the number of
 * DISTINCT SKUs going to that destination (SKU = product + colourway + size;
 * decorations and unit quantities never move the count).
 *
 * 1-10 = $15, 11-20 = $17.50, 21-30 = $20, 31-40 = $22.50, 41-50 = $30.
 * Above 50 the schedule continues arithmetically: +$2.50 per further block of
 * 10, uncapped (51-60 = $32.50, 61-70 = $35, ...). The spreadsheet Jon supplied
 * stops at 47; the tail is extrapolated above 47, confirmed by Jon 2026-08-28.
 *
 * Charged on EVERY destination of a split order, including the first, and it
 * replaces the picking fee there (see checkoutPickingFee's splitShipment gate).
 * Figures are NZD; converting to a non-NZD partition currency is the caller's
 * job (prepare.ts), not this module's.
 */
export const SPLIT_FEE_BANDS: ReadonlyArray<{ maxSkus: number; fee: number }> = [
  { maxSkus: 10, fee: 15 },
  { maxSkus: 20, fee: 17.5 },
  { maxSkus: 30, fee: 20 },
  { maxSkus: 40, fee: 22.5 },
  { maxSkus: 50, fee: 30 },
]

/** Fee step and block size for the open-ended region past the last band. */
const TAIL_STEP = 2.5
const TAIL_BLOCK = 10

export function splitFeeForSkuCount(skuCount: number): number {
  if (!Number.isFinite(skuCount) || skuCount <= 0) return 0

  for (const band of SPLIT_FEE_BANDS) {
    if (skuCount <= band.maxSkus) return band.fee
  }

  // Past the table: $30 at 50 SKUs, then +$2.50 for each further block of 10.
  const last = SPLIT_FEE_BANDS[SPLIT_FEE_BANDS.length - 1]
  const blocksPast = Math.ceil((skuCount - last.maxSkus) / TAIL_BLOCK)
  return last.fee + TAIL_STEP * blocksPast
}

type SkuIdentity = Pick<CheckoutLineInput, 'product_id' | 'variant_id' | 'size_id'>

/**
 * Distinct SKUs among the given lines. Absent and null identity parts collapse
 * to the same SKU, so a sizeless product counts once however it was spelled.
 */
export function distinctSkuCount(lines: SkuIdentity[]): number {
  const seen = new Set<string>()
  for (const line of lines) {
    // '|' cannot appear in a uuid, so it is a safe delimiter: without one,
    // ('p1','v1',12) and ('p1','v11',2) would collide on the same key.
    seen.add(`${line.product_id}|${line.variant_id ?? ''}|${line.size_id ?? ''}`)
  }
  return seen.size
}
