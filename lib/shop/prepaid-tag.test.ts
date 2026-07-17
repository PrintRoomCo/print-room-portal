import { describe, it, expect } from 'vitest'
import { isPrepaidDrawn, showsPrepaidStockBadge } from './prepaid-tag'

describe('isPrepaidDrawn', () => {
  it('true for a prepaid line that draws stock', () => {
    expect(isPrepaidDrawn('stocked', 'prepaid')).toBe(true)
  })

  // The defect this rename fixes. A made-to-order line of a prepaid variant is
  // PRODUCED, so Xero charges it (qty_from_stock = 0). The old predicate took
  // the product's `nature` and returned true for 'mixed', badging a line we bill
  // in full.
  it('false for a prepaid line that is made to order', () => {
    expect(isPrepaidDrawn('made_to_order', 'prepaid')).toBe(false)
  })

  it('false for a stocked line that is not prepaid', () => {
    expect(isPrepaidDrawn('stocked', 'invoice_on_dispatch')).toBe(false)
  })

  it('false when billingMode is null (legacy line — fail closed, charge it)', () => {
    expect(isPrepaidDrawn('stocked', null)).toBe(false)
  })

  it('false when fulfilmentType is absent (legacy line — treated as produced)', () => {
    expect(isPrepaidDrawn(undefined, 'prepaid')).toBe(false)
  })
})

describe('showsPrepaidStockBadge', () => {
  it('true for a prepaid stocked product', () => {
    expect(showsPrepaidStockBadge('stocked', 'prepaid')).toBe(true)
  })

  // The difference from isPrepaidDrawn, and the reason both exist. The PDP asks
  // "can this draw prepaid stock?" before any ordering mode is chosen, so a
  // mixed product answers yes. isPrepaidDrawn('mixed', …) isn't even expressible
  // — a chosen mode is only ever 'stocked' or 'made_to_order'.
  it('true for a prepaid mixed product — it CAN draw stock', () => {
    expect(showsPrepaidStockBadge('mixed', 'prepaid')).toBe(true)
  })

  it('false for a prepaid made_to_order product — it can never draw stock', () => {
    expect(showsPrepaidStockBadge('made_to_order', 'prepaid')).toBe(false)
  })

  it('false when the variant is not prepaid', () => {
    expect(showsPrepaidStockBadge('stocked', 'invoice_on_dispatch')).toBe(false)
    expect(showsPrepaidStockBadge('mixed', null)).toBe(false)
  })
})
