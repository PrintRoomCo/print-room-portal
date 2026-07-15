// lib/xero/eligibility.ts

export type XeroIneligibleReason = 'disabled' | 'already_drafted' | 'test_org'
export type XeroEligibilityReason = 'ok' | XeroIneligibleReason

export interface XeroEligibilityInput {
  /** isXeroEnabled() result. */
  xeroEnabled: boolean
  /** orders.xero_invoice_id — non-null means a draft already exists. */
  existingInvoiceId: string | null
  /** organizations.is_test. */
  isTestOrg: boolean
}

export interface XeroEligibility {
  eligible: boolean
  reason: XeroEligibilityReason
}

/**
 * Draft a Xero DRAFT quote iff ALL hold: feature on, not already drafted, and
 * not a test org. Spec A: EVERY non-test order is invoiced — purchase orders
 * and stock-on-hand orders alike. There is no order-type, payment-terms, or
 * stock-draw branch (prepay is deferred to Spec B). Order of checks defines
 * precedence (see test): disabled/already_drafted → fully inert; test_org →
 * the caller records xero_invoice_status='skipped'.
 */
export function evaluateXeroEligibility(input: XeroEligibilityInput): XeroEligibility {
  if (!input.xeroEnabled) return { eligible: false, reason: 'disabled' }
  if (input.existingInvoiceId) return { eligible: false, reason: 'already_drafted' }
  if (input.isTestOrg) return { eligible: false, reason: 'test_org' }
  return { eligible: true, reason: 'ok' }
}
