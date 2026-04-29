import type { LineBreakdown, OrderBreakdown, PricingMode } from './types'

/**
 * Round half-up to 2 decimals. Avoids JS float drift for cent math.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Reverse the tier discount to recover the gross (pre-discount) unit price.
 * In `catalogue` and `standard` modes the effective price IS the gross — no inversion.
 */
export function computeUnitGross(
  unitEffective: number,
  tierDiscount: number,
  pricingMode: PricingMode
): number {
  if (pricingMode !== 'tiered') return unitEffective
  if (tierDiscount <= 0 || tierDiscount >= 1) return unitEffective
  return round2(unitEffective / (1 - tierDiscount))
}

interface LineInput {
  qty: number
  unitEffective: number
  decorationPerUnit: number
  tierDiscount: number
  pricingMode: PricingMode
}

export function computeLineBreakdown(input: LineInput): LineBreakdown {
  const { qty, unitEffective, decorationPerUnit, tierDiscount, pricingMode } = input
  const deco = Number.isFinite(decorationPerUnit) ? Math.max(0, decorationPerUnit) : 0
  const unitGross = computeUnitGross(unitEffective, tierDiscount, pricingMode)
  const lineGross = round2(qty * (unitGross + deco))
  const lineDiscount =
    pricingMode === 'tiered' ? round2(qty * (unitGross - unitEffective)) : 0
  const lineNet = round2(lineGross - lineDiscount)
  return {
    qty,
    unitEffective,
    unitGross,
    decorationPerUnit: deco,
    lineGross,
    lineDiscount,
    lineNet,
  }
}

interface OrderInput {
  lines: Array<Pick<LineInput, 'qty' | 'unitEffective' | 'decorationPerUnit'>>
  tierDiscount: number
  pricingMode: PricingMode
  gstRate: number
}

export function computeOrderBreakdown(input: OrderInput): OrderBreakdown {
  const { lines: linesIn, tierDiscount, pricingMode, gstRate } = input
  const lines = linesIn.map((l) =>
    computeLineBreakdown({
      qty: l.qty,
      unitEffective: l.unitEffective,
      decorationPerUnit: l.decorationPerUnit,
      tierDiscount,
      pricingMode,
    })
  )
  const grossSubtotal = round2(lines.reduce((s, l) => s + l.lineGross, 0))
  const decorationTotal = round2(
    lines.reduce((s, l) => s + l.qty * l.decorationPerUnit, 0)
  )
  const discountAmount = round2(lines.reduce((s, l) => s + l.lineDiscount, 0))
  const netSubtotal = round2(grossSubtotal - discountAmount)
  const gst = round2(netSubtotal * gstRate)
  const total = round2(netSubtotal + gst)
  return {
    lines,
    grossSubtotal,
    decorationTotal,
    discountAmount,
    netSubtotal,
    gstRate,
    gst,
    total,
  }
}
