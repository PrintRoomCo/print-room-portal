import { describe, it, expect } from 'vitest'
import { orderNeedsInvoicing } from './order-billing'

describe('orderNeedsInvoicing (any stocked line not-paid)', () => {
  it('false when no stocked lines', () =>
    expect(orderNeedsInvoicing([{ stocked: false, billingMode: 'invoice_on_dispatch' }])).toBe(false))
  it('false when every stocked line is prepaid', () =>
    expect(orderNeedsInvoicing([
      { stocked: true, billingMode: 'prepaid' },
      { stocked: false, billingMode: 'invoice_on_dispatch' },
    ])).toBe(false))
  it('true when any stocked line is not-paid', () =>
    expect(orderNeedsInvoicing([
      { stocked: true, billingMode: 'prepaid' },
      { stocked: true, billingMode: 'invoice_on_dispatch' },
    ])).toBe(true))
})
