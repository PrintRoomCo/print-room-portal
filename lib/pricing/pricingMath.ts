import type { LineBreakdown, OrderBreakdown } from './types'

/**
 * Round half-up to 2 decimals. Avoids JS float drift for cent math.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

interface LineInput {
  qty: number
  unitEffective: number
  decorationPerUnit: number
}

export function computeLineBreakdown(input: LineInput): LineBreakdown {
  const { qty, unitEffective, decorationPerUnit } = input
  const deco = Number.isFinite(decorationPerUnit) ? Math.max(0, decorationPerUnit) : 0
  const lineGross = round2(qty * (unitEffective + deco))
  return {
    qty,
    unitEffective,
    unitGross: unitEffective,
    decorationPerUnit: deco,
    lineGross,
    lineDiscount: 0,
    lineNet: lineGross,
  }
}

interface OrderInput {
  lines: Array<Pick<LineInput, 'qty' | 'unitEffective' | 'decorationPerUnit'>>
  gstRate: number
  pickingFee?: number
}

export function computeOrderBreakdown(input: OrderInput): OrderBreakdown {
  const { lines: linesIn, gstRate } = input
  const lines = linesIn.map((l) =>
    computeLineBreakdown({
      qty: l.qty,
      unitEffective: l.unitEffective,
      decorationPerUnit: l.decorationPerUnit,
    })
  )
  const grossSubtotal = round2(lines.reduce((s, l) => s + l.lineGross, 0))
  const decorationTotal = round2(
    lines.reduce((s, l) => s + l.qty * l.decorationPerUnit, 0)
  )
  const netSubtotal = grossSubtotal
  const pickingFee = round2(Math.max(0, input.pickingFee ?? 0))
  const gst = round2((netSubtotal + pickingFee) * gstRate)
  const total = round2(netSubtotal + pickingFee + gst)
  return {
    lines,
    grossSubtotal,
    decorationTotal,
    discountAmount: 0,
    netSubtotal,
    pickingFee,
    gstRate,
    gst,
    total,
  }
}
