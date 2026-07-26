/** Fired on window when a PDP add pushes a product past its soft cap. */
export const QTY_CAP_WARNING_EVENT = 'pr:qty-cap-warning'

export interface QtyCapWarningDetail {
  productName: string
  total: number
  max: number
}

/**
 * Soft-cap check for a PDP add: existing cart qty for the product plus the
 * quantity being added. Null = no warning. NEVER used to block the add —
 * the cap is advisory (Chris feature #9, warn-only by decision 2026-07-25).
 */
export function qtyCapWarningFor(
  existingQty: number,
  addedQty: number,
  effectiveMaxQty: number | null,
): { total: number; max: number } | null {
  if (effectiveMaxQty == null || effectiveMaxQty <= 0) return null
  const total = existingQty + addedQty
  return total > effectiveMaxQty ? { total, max: effectiveMaxQty } : null
}
