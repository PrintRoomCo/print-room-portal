// lib/xero/__tests__/eligibility.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateXeroEligibility, type XeroEligibilityInput } from '../eligibility'

const base: XeroEligibilityInput = {
  xeroEnabled: true,
  existingInvoiceId: null,
  isTestOrg: false,
  paymentTerms: 'net20',
  drawsStock: false,
}

describe('evaluateXeroEligibility', () => {
  it('drafts a clean net-terms pure-production order', () => {
    expect(evaluateXeroEligibility(base)).toEqual({ eligible: true, reason: 'ok' })
  })

  it('drafts an add-to-inventory production run (no stock draw, net terms)', () => {
    // intent==="inventory" has no stocked lines → drawsStock false → drafted.
    expect(evaluateXeroEligibility({ ...base, drawsStock: false })).toEqual({ eligible: true, reason: 'ok' })
  })

  it('skips when the feature flag is off (checked first, fully inert)', () => {
    expect(evaluateXeroEligibility({ ...base, xeroEnabled: false, drawsStock: true, isTestOrg: true }))
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

  it('flags prepay orgs (billed bespoke)', () => {
    expect(evaluateXeroEligibility({ ...base, paymentTerms: 'prepay' }))
      .toEqual({ eligible: false, reason: 'prepay_org' })
  })

  it('flags any stock-draw order (can not tell paid from unpaid stock in v1)', () => {
    expect(evaluateXeroEligibility({ ...base, drawsStock: true }))
      .toEqual({ eligible: false, reason: 'draws_stock' })
  })

  it('precedence: disabled > already_drafted > test_org > prepay_org > draws_stock', () => {
    expect(evaluateXeroEligibility({
      xeroEnabled: true, existingInvoiceId: 'inv', isTestOrg: true, paymentTerms: 'prepay', drawsStock: true,
    })).toEqual({ eligible: false, reason: 'already_drafted' })
  })
})
