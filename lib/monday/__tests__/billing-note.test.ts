import { describe, it, expect } from 'vitest'
import { orderBillingNote } from '../billing-note'

describe('orderBillingNote', () => {
  it('prepaid order (no invoicing) — pick fee only', () => {
    expect(orderBillingNote({ needsInvoicing: false, pickFee: 30 }))
      .toBe('Prepaid — no Xero invoice required (pick fee $30.00 only).')
  })
  it('not-paid order — draft quote raised', () => {
    expect(orderBillingNote({ needsInvoicing: true, pickFee: 30 }))
      .toBe('Not paid — draft quote raised, invoice before dispatch. Pick fee $30.00.')
  })
})
