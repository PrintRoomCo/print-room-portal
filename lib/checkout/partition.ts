import type { CheckoutLineInput } from '@/lib/checkout/submit'

export type CheckoutOrderType = 'purchase_order' | 'stock_on_hand'

export interface FulfilmentPartition<T> {
  orderType: CheckoutOrderType
  lines: T[]
}

export type CheckoutPartition = FulfilmentPartition<CheckoutLineInput>

/**
 * The split rule, independent of line shape: a line joins 'stock_on_hand' iff
 * `isStocked` says it draws stock; everything else joins 'purchase_order'.
 * purchase_order is returned FIRST (the primary/tracked order), then
 * stock_on_hand. Never returns an empty-lines partition; returns [] for empty
 * input.
 *
 * Generic because two callers hold different line shapes: the server submits
 * snake_case CheckoutLineInput, while the customer checkout summary
 * (lib/pricing/order-billing-shape.ts) holds camelCase cart lines. One rule in
 * one place, so the order groups the customer sees are the orders the server
 * actually creates.
 */
export function partitionByFulfilment<T>(
  lines: T[],
  isStocked: (line: T) => boolean,
): Array<FulfilmentPartition<T>> {
  const purchaseOrder: T[] = []
  const stockOnHand: T[] = []
  for (const line of lines) {
    if (isStocked(line)) stockOnHand.push(line)
    else purchaseOrder.push(line)
  }
  const out: Array<FulfilmentPartition<T>> = []
  if (purchaseOrder.length > 0) out.push({ orderType: 'purchase_order', lines: purchaseOrder })
  if (stockOnHand.length > 0) out.push({ orderType: 'stock_on_hand', lines: stockOnHand })
  return out
}

/**
 * Split checkout lines into at most two homogeneous orders by fulfilment.
 * A line joins the 'stock_on_hand' partition iff its fulfilment_type is
 * exactly 'stocked' (a stock DRAW). 'made_to_order' AND absent/legacy lines
 * join 'purchase_order' — matching submit_b2b_order's MOQ-conservative
 * treatment of an absent fulfilment_type.
 */
export function partitionCheckoutLines(lines: CheckoutLineInput[]): CheckoutPartition[] {
  return partitionByFulfilment(lines, (line) => line.fulfilment_type === 'stocked')
}
