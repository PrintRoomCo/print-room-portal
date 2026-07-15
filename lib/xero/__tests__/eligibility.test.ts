// lib/xero/__tests__/eligibility.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateXeroEligibility, type XeroEligibilityInput } from '../eligibility'

const base: XeroEligibilityInput = {
  xeroEnabled: true,
  existingInvoiceId: null,
  isTestOrg: false,
}

describe('evaluateXeroEligibility', () => {
  it('drafts a non-test order with no existing draft (any order type)', () => {
    // Spec A: purchase orders AND stock-on-hand orders both draft — no
    // order-type, payment-terms, or stock-draw branch remains.
    expect(evaluateXeroEligibility(base)).toEqual({ eligible: true, reason: 'ok' })
  })

  it('ignores legacy prepay / stock-draw inputs — no such gate remains (Spec A)', () => {
    // Older callers spread paymentTerms + drawsStock; the new rule ignores them.
    const legacy = { ...base, paymentTerms: 'prepay', drawsStock: true } as XeroEligibilityInput
    expect(evaluateXeroEligibility(legacy)).toEqual({ eligible: true, reason: 'ok' })
  })

  it('skips when the feature flag is off (checked first, fully inert)', () => {
    expect(evaluateXeroEligibility({ ...base, xeroEnabled: false, isTestOrg: true }))
      .toEqual({ eligible: false, reason: 'disabled' })
  })

  it('skips when already drafted (dedup)', () => {
    expect(evaluateXeroEligibility({ ...base, existingInvoiceId: 'inv-9' }))
      .toEqual({ eligible: false, reason: 'already_drafted' })
  })

  it('skips test orgs (keep the real ledger clean)', () => {
    expect(evaluateXeroEligibility({ ...base, isTestOrg: true }))
      .toEqual({ eligible: false, reason: 'test_org' })
  })

  it('precedence: disabled > already_drafted > test_org', () => {
    expect(evaluateXeroEligibility({
      xeroEnabled: true, existingInvoiceId: 'inv', isTestOrg: true,
    })).toEqual({ eligible: false, reason: 'already_drafted' })
  })
})
