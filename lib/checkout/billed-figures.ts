export interface BilledFigures {
  /** Ex-GST goods actually invoiced. Prepaid draws contribute 0. */
  billedGoods: number
  /** Ex-GST total invoiced: billedGoods + pickingFee. */
  billedExGst: number
  pickingFee: number
  /** Goods drawn from pre-paid stock and NOT invoiced. 0 for a normal order. */
  prepaidGoodsValue: number
}

/**
 * Unpack a persisted order's stored figures into the parts a customer-facing
 * surface renders.
 *
 * The inverse of billedOrderTotal (submit.ts): that folds goods + fee into
 * quotes.billed_total, and this recovers how much was zeroed by subtracting the
 * billed goods from the full goods value. Shared by the confirmation page and
 * the customer email — the two must never disagree about the same order, which
 * is the whole point of this spec.
 *
 * Reads the SNAPSHOT; never recomputes from billing_mode, which is mutable and
 * would rewrite the history of an old order.
 *
 * `billedTotal` null ⇒ the order predates the column. Those orders had no
 * prepaid zeroing and no fee line, so the goods value IS what was billed — fall
 * back to it rather than reporting $0.
 */
export function billedFigures(input: {
  /** quotes.subtotal — the ex-GST full GOODS value. Always present. */
  goodsExGst: number
  /** quotes.billed_total. Null for orders placed before the column existed. */
  billedTotal: number | null | undefined
  /** quotes.picking_fee. Null/absent ⇒ 0. */
  pickingFee: number | null | undefined
}): BilledFigures {
  const goods = num(input.goodsExGst)
  const pickingFee = num(input.pickingFee)
  const billedExGst = input.billedTotal != null ? num(input.billedTotal) : goods
  const billedGoods = round2(billedExGst - pickingFee)
  return {
    billedGoods,
    billedExGst,
    pickingFee,
    // Never negative: a corrupt/rounding-skewed pair must not render as a
    // nonsense credit.
    prepaidGoodsValue: round2(Math.max(0, goods - billedGoods)),
  }
}

function num(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
