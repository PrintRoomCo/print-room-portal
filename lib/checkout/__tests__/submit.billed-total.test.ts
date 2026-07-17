import { describe, it, expect } from 'vitest'
import { billedOrderTotal } from '../submit'

const prepaidDraw = {
  stocked: true,
  billingMode: 'prepaid' as const,
  goodsValue: 1465.2,
  decorationRevenue: 0,
}
const billedStock = {
  stocked: true,
  billingMode: 'invoice_on_dispatch' as const,
  goodsValue: 500,
  decorationRevenue: 0,
}
const prepaidProduced = {
  stocked: false,
  billingMode: 'prepaid' as const,
  goodsValue: 400,
  decorationRevenue: 0,
}

describe('billedOrderTotal', () => {
  // Chris's case: 120 tees drawn from prepaid stock bill nothing but the fee.
  it('bills only the picking fee for a wholly prepaid draw', () => {
    expect(billedOrderTotal([prepaidDraw], 15)).toBe(15)
  })

  it('bills goods plus the fee for a non-prepaid stock order', () => {
    expect(billedOrderTotal([billedStock], 15)).toBe(515)
  })

  // The `nature` defect in server terms: produced goods are charged even when
  // the variant is prepaid, matching draft-invoice.ts's qty_from_stock gate.
  it('CHARGES a prepaid variant that was produced, not drawn', () => {
    expect(billedOrderTotal([prepaidProduced], 0)).toBe(400)
  })

  it('excludes decoration on a prepaid draw — it was paid for with the stock', () => {
    expect(billedOrderTotal([{ ...prepaidDraw, decorationRevenue: 240 }], 15)).toBe(15)
  })

  it('includes decoration on a billed line', () => {
    expect(billedOrderTotal([{ ...billedStock, decorationRevenue: 50 }], 15)).toBe(565)
  })

  it('sums a mixed set', () => {
    expect(billedOrderTotal([prepaidDraw, billedStock], 15)).toBe(515)
  })

  it('is the fee alone for an empty line set', () => {
    expect(billedOrderTotal([], 15)).toBe(15)
  })

  it('rounds to cents', () => {
    expect(
      billedOrderTotal([{ ...billedStock, goodsValue: 0.1, decorationRevenue: 0.2 }], 0),
    ).toBe(0.3)
  })
})
