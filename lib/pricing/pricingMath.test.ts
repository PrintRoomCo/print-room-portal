import { describe, expect, it } from 'vitest'
import {
  computeLineBreakdown,
  computeOrderBreakdown,
  round2,
} from './pricingMath'

describe('round2', () => {
  it('rounds to 2 decimals using banker-safe + half-up', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(1.004)).toBe(1.00)
    expect(round2(0)).toBe(0)
    expect(round2(7.755)).toBeCloseTo(7.76, 2)
  })
})

describe('computeLineBreakdown', () => {
  it('catalogue mode: 50 units @ $7.75, no decoration', () => {
    const lb = computeLineBreakdown({
      qty: 50,
      unitEffective: 7.75,
      decorationPerUnit: 0,
    })
    expect(lb.unitGross).toBe(7.75)
    expect(lb.lineDiscount).toBe(0)
    expect(lb.lineGross).toBeCloseTo(387.50, 2)
    expect(lb.lineNet).toBeCloseTo(387.50, 2)
  })

  it('decoration is added per unit', () => {
    const lb = computeLineBreakdown({
      qty: 10,
      unitEffective: 9.00,
      decorationPerUnit: 1.50,
    })
    expect(lb.unitGross).toBe(9.00)
    expect(lb.lineDiscount).toBe(0)
    expect(lb.lineGross).toBeCloseTo(105.00, 2) // (9 + 1.50) × 10
    expect(lb.lineNet).toBeCloseTo(105.00, 2)
  })

  it('decoration zero/null treated as 0', () => {
    const lb = computeLineBreakdown({
      qty: 2,
      unitEffective: 10,
      decorationPerUnit: 0,
    })
    expect(lb.decorationPerUnit).toBe(0)
    expect(lb.lineGross).toBe(20)
  })
})

describe('computeOrderBreakdown', () => {
  it('catalogue: discountAmount stays 0', () => {
    const ob = computeOrderBreakdown({
      lines: [{ qty: 50, unitEffective: 7.75, decorationPerUnit: 0 }],
      gstRate: 0.15,
    })
    expect(ob.discountAmount).toBe(0)
    expect(ob.netSubtotal).toBeCloseTo(387.50, 2)
    expect(ob.gst).toBeCloseTo(58.13, 2)
    expect(ob.total).toBeCloseTo(445.63, 2)
  })

  it('zero lines yields zero totals', () => {
    const ob = computeOrderBreakdown({
      lines: [],
      gstRate: 0.15,
    })
    expect(ob.grossSubtotal).toBe(0)
    expect(ob.netSubtotal).toBe(0)
    expect(ob.gst).toBe(0)
    expect(ob.total).toBe(0)
  })

  it('PRT smoke: 3 catalogue products at qty=50', () => {
    const ob = computeOrderBreakdown({
      lines: [
        { qty: 50, unitEffective: 7.75,  decorationPerUnit: 0 }, // Cord Bucket Hat
        { qty: 50, unitEffective: 17.55, decorationPerUnit: 0 }, // Womens Contrast Scrub Top
        { qty: 50, unitEffective: 8.50,  decorationPerUnit: 0 }, // Happy Feet Comfort Socks
      ],
      gstRate: 0.15,
    })
    expect(ob.netSubtotal).toBeCloseTo(1690.00, 2)
    expect(ob.discountAmount).toBe(0)
    expect(ob.gst).toBeCloseTo(253.50, 2)
    expect(ob.total).toBeCloseTo(1943.50, 2)
  })
})
