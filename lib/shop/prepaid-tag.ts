import type { BillingMode } from './billing-mode'
import type { FulfilmentType } from './fulfilment-mode'
import type { CartLineFulfilmentType } from '@/lib/cart/types'

/**
 * Is this line a prepaid stock DRAW — goods the org has already paid for, so we
 * invoice them at $0?
 *
 * The single predicate behind BOTH the checkout "Pre-paid" badge and the billed
 * price. They must never diverge: a badge that says "Pre-paid" on a line we
 * charge in full is a lie, and a $0 line we invoice in full is a money bug.
 *
 * Keyed on `fulfilmentType` — the CHOSEN mode — and deliberately never on
 * `nature`, the product's capability (see showsPrepaidStockBadge for that
 * question). A 'mixed'-nature product can be ordered either way; only the choice
 * decides whether stock is drawn. This mirrors the server's zeroing gate in
 * draft-invoice.ts (qty_from_stock > 0): a prepaid variant's made-to-order line
 * is produced, and produced goods are charged.
 *
 * Absent fulfilmentType (legacy persisted line) → treated as produced, i.e.
 * charged. Unknown/null billingMode → charged. Both fail closed by design.
 */
export function isPrepaidDrawn(
  fulfilmentType: CartLineFulfilmentType | undefined,
  billingMode: BillingMode | null,
): boolean {
  if (billingMode !== 'prepaid') return false
  return fulfilmentType === 'stocked'
}

/**
 * CAN this product be drawn from pre-paid stock — i.e. is it worth telling the
 * customer "your stock of this is already paid for"?
 *
 * A different question from isPrepaidDrawn, for a different surface. The PDP
 * asks this BEFORE the customer picks an ordering mode, so it keys on the
 * product's `nature` (its capability) and 'mixed' answers yes: a mixed product
 * genuinely can draw prepaid stock, even though the same product ordered as a
 * production run would be charged.
 *
 * Informational only — it must never drive a price. The moment a line has a
 * chosen fulfilment, isPrepaidDrawn is the predicate, because only the choice
 * decides what is billed.
 */
export function showsPrepaidStockBadge(
  nature: FulfilmentType,
  billingMode: BillingMode | null,
): boolean {
  if (billingMode !== 'prepaid') return false
  return nature === 'stocked' || nature === 'mixed'
}
