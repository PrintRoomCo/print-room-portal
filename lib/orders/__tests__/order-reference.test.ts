import { describe, it, expect } from 'vitest'
import { getOrderReference } from '../order-reference'

describe('getOrderReference', () => {
  it('prefers order_ref (the checkout-issued PREFIX-000000)', () => {
    expect(
      getOrderReference({
        orderRef: 'DEMO-000104',
        quoteNumber: 'Anfield Cup Winners',
        reference: null,
      }),
    ).toBe('DEMO-000104')
  })

  it('falls back to quote_number, then job_reference, then reference', () => {
    expect(getOrderReference({ orderRef: null, quoteNumber: 'ANFI-000083' })).toBe('ANFI-000083')
    expect(getOrderReference({ jobReference: 'NEOC-3781' })).toBe('NEOC-3781')
    expect(getOrderReference({ reference: 'LEGACY-1' })).toBe('LEGACY-1')
  })

  it('ignores blank / whitespace-only values', () => {
    expect(getOrderReference({ orderRef: '   ', quoteNumber: 'DEMO-000200' })).toBe('DEMO-000200')
  })

  it('returns null when no reference exists — callers render a neutral fallback, never a UUID', () => {
    expect(getOrderReference({ orderRef: null, quoteNumber: null, reference: null })).toBeNull()
    expect(getOrderReference({})).toBeNull()
  })
})
