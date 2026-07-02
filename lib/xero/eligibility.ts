// lib/xero/eligibility.ts

export type XeroIneligibleReason =
  | 'disabled'
  | 'already_drafted'
  | 'test_org'
  | 'prepay_org'
  | 'draws_stock'
export type XeroEligibilityReason = 'ok' | XeroIneligibleReason

export interface XeroEligibilityInput {
  /** isXeroEnabled() result. */
  xeroEnabled: boolean
  /** orders.xero_invoice_id — non-null means a draft already exists. */
  existingInvoiceId: string | null
  /** organizations.is_test. */
  isTestOrg: boolean
  /** 'prepay' | 'net20' | 'net30' | null. */
  paymentTerms: string | null
  /** True if ANY order line draws from existing stock. */
  drawsStock: boolean
}

export interface XeroEligibility {
  eligible: boolean
  reason: XeroEligibilityReason
}

/**
 * Draft a Xero invoice iff ALL hold: feature on, not already drafted, not a test
 * org, not a prepay org, and no line draws stock. Order of checks defines
 * precedence (see test). draws_stock/prepay_org → the caller flags manual_review;
 * disabled/already_drafted/test_org → skipped.
 */
export function evaluateXeroEligibility(input: XeroEligibilityInput): XeroEligibility {
  if (!input.xeroEnabled) return { eligible: false, reason: 'disabled' }
  if (input.existingInvoiceId) return { eligible: false, reason: 'already_drafted' }
  if (input.isTestOrg) return { eligible: false, reason: 'test_org' }
  if (input.paymentTerms === 'prepay') return { eligible: false, reason: 'prepay_org' }
  if (input.drawsStock) return { eligible: false, reason: 'draws_stock' }
  return { eligible: true, reason: 'ok' }
}
