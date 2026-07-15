import { describe, it, expect } from 'vitest'
import { showsPrepaidTag } from './prepaid-tag'

describe('showsPrepaidTag', () => {
  it('true for prepaid stocked', () => expect(showsPrepaidTag('stocked', 'prepaid')).toBe(true))
  it('true for prepaid mixed', () => expect(showsPrepaidTag('mixed', 'prepaid')).toBe(true))
  it('false for prepaid made_to_order', () => expect(showsPrepaidTag('made_to_order', 'prepaid')).toBe(false))
  it('false for not-paid stocked', () => expect(showsPrepaidTag('stocked', 'invoice_on_dispatch')).toBe(false))
  it('false when billingMode null (legacy)', () => expect(showsPrepaidTag('stocked', null)).toBe(false))
})
