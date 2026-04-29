import { describe, expect, it } from 'vitest'
import {
  computeUnitGross,
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

describe('computeUnitGross', () => {
  it('returns the effective price unchanged in catalogue mode', () => {
    expect(computeUnitGross(7.75, 0.10, 'catalogue')).toBe(7.75)
  })
  it('returns the effective price unchanged in standard mode (zero discount)', () => {
    expect(computeUnitGross(10.00, 0, 'standard')).toBe(10.00)
  })
  it('inverts the discount in tiered mode', () => {
    // gross × (1 - 0.10) = effective  →  gross = effective ÷ 0.90
    expect(computeUnitGross(9.00, 0.10, 'tiered')).toBeCloseTo(10.00, 2)
  })
  it('handles 5% Trade discount', () => {
    // gross × 0.95 = 9.50  →  gross = 10.00
    expect(computeUnitGross(9.50, 0.05, 'tiered')).toBeCloseTo(10.00, 2)
  })
  it('returns effective when tieredDiscount is 0', () => {
    expect(computeUnitGross(10, 0, 'tiered')).toBe(10)
  })
})

describe('computeLineBreakdown', () => {
  it('tiered mode: 10 units @ effective $9.00, gross $10.00, decoration $1.50', () => {
    const lb = computeLineBreakdown({
      qty: 10,
      unitEffective: 9.00,
      decorationPerUnit: 1.50,
      tierDiscount: 0.10,
      pricingMode: 'tiered',
    })
    expect(lb.unitGross).toBeCloseTo(10.00, 2)
    expect(lb.unitEffective).toBe(9.00)
    expect(lb.lineGross).toBeCloseTo(115.00, 2) // (10 + 1.50) × 10
    expect(lb.lineDiscount).toBeCloseTo(10.00, 2) // (10.00 - 9.00) × 10
    expect(lb.lineNet).toBeCloseTo(105.00, 2)    // 115 - 10
  })

  it('catalogue mode: no synthetic discount even if tier-discount fraction > 0', () => {
    const lb = computeLineBreakdown({
      qty: 50,
      unitEffective: 7.75,
      decorationPerUnit: 0,
      tierDiscount: 0.10,
      pricingMode: 'catalogue',
    })
    expect(lb.unitGross).toBe(7.75)
    expect(lb.lineDiscount).toBe(0)
    expect(lb.lineGross).toBeCloseTo(387.50, 2)
    expect(lb.lineNet).toBeCloseTo(387.50, 2)
  })

  it('standard mode: no discount, no decoration', () => {
    const lb = computeLineBreakdown({
      qty: 3,
      unitEffective: 25,
      decorationPerUnit: 0,
      tierDiscount: 0,
      pricingMode: 'standard',
    })
    expect(lb.lineGross).toBe(75)
    expect(lb.lineDiscount).toBe(0)
    expect(lb.lineNet).toBe(75)
  })

  it('decoration zero/null treated as 0', () => {
    const lb = computeLineBreakdown({
      qty: 2,
      unitEffective: 10,
      decorationPerUnit: 0,
      tierDiscount: 0,
      pricingMode: 'standard',
    })
    expect(lb.decorationPerUnit).toBe(0)
    expect(lb.lineGross).toBe(20)
  })
})

describe('computeOrderBreakdown', () => {
  it('tiered: two lines reconcile subtotal + decoration − discount + GST = total to cents', () => {
    const ob = computeOrderBreakdown({
      lines: [
        { qty: 10, unitEffective: 9.00, decorationPerUnit: 1.50 },
        { qty: 5,  unitEffective: 18.00, decorationPerUnit: 0 },
      ],
      tierDiscount: 0.10,
      pricingMode: 'tiered',
      gstRate: 0.15,
    })
    // line 1: gross 10×(10+1.5)=115, discount 10×1=10, net 105
    // line 2: gross 5×20=100, discount 5×2=10, net 90  (gross unit=18/0.9=20)
    expect(ob.grossSubtotal).toBeCloseTo(215.00, 2)
    expect(ob.decorationTotal).toBeCloseTo(15.00, 2)
    expect(ob.discountAmount).toBeCloseTo(20.00, 2)
    expect(ob.netSubtotal).toBeCloseTo(195.00, 2)
    expect(ob.gst).toBeCloseTo(29.25, 2)
    expect(ob.total).toBeCloseTo(224.25, 2)
    // Reconciliation: net + gst = total
    expect(ob.netSubtotal + ob.gst).toBeCloseTo(ob.total, 2)
  })

  it('catalogue: discountAmount stays 0 even at 10% tier_discount input', () => {
    const ob = computeOrderBreakdown({
      lines: [{ qty: 50, unitEffective: 7.75, decorationPerUnit: 0 }],
      tierDiscount: 0.10,
      pricingMode: 'catalogue',
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
      tierDiscount: 0.10,
      pricingMode: 'tiered',
      gstRate: 0.15,
    })
    expect(ob.grossSubtotal).toBe(0)
    expect(ob.netSubtotal).toBe(0)
    expect(ob.gst).toBe(0)
    expect(ob.total).toBe(0)
  })

  it('PRT smoke: 3 catalogue products at qty=50', () => {
    // From SQL verification 2026-04-29: catalogue prices 7.75, 17.55, 8.50, no decoration.
    const ob = computeOrderBreakdown({
      lines: [
        { qty: 50, unitEffective: 7.75,  decorationPerUnit: 0 }, // Cord Bucket Hat
        { qty: 50, unitEffective: 17.55, decorationPerUnit: 0 }, // Womens Contrast Scrub Top
        { qty: 50, unitEffective: 8.50,  decorationPerUnit: 0 }, // Happy Feet Comfort Socks
      ],
      tierDiscount: 0.10,
      pricingMode: 'catalogue',
      gstRate: 0.15,
    })
    expect(ob.netSubtotal).toBeCloseTo(1690.00, 2) // (7.75+17.55+8.50) × 50
    expect(ob.discountAmount).toBe(0)
    expect(ob.gst).toBeCloseTo(253.50, 2)
    expect(ob.total).toBeCloseTo(1943.50, 2)
  })
})
