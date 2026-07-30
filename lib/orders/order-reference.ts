/**
 * Canonical customer-facing order reference (Anna portal feedback, Monday
 * 2809678055 + 2809660425).
 *
 * The SAME order must read the same way on every surface — the human reference
 * such as "DEMO-000104", never a raw UUID, and never a different field on the
 * detail page than in the list. Before this, the past-orders list showed
 * `order_ref` while the detail page read only `quote.reference` (usually null)
 * and fell back to a sliced UUID ("Order 906C969D").
 *
 * Priority: `orderRef` (the PREFIX-000000 issued at checkout) → `quoteNumber` /
 * `jobReference` (the same code under other names) → `reference` (legacy). When
 * none resolve, callers render a neutral fallback — NEVER a sliced UUID.
 */
export interface OrderReferenceFields {
  orderRef?: string | null
  quoteNumber?: string | null
  jobReference?: string | null
  reference?: string | null
}

/** The best human reference for an order, or `null` when none is available. */
export function getOrderReference(fields: OrderReferenceFields): string | null {
  for (const candidate of [
    fields.orderRef,
    fields.quoteNumber,
    fields.jobReference,
    fields.reference,
  ]) {
    const value = candidate?.trim()
    if (value) return value
  }
  return null
}
