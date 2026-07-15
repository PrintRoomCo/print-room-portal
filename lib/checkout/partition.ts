import type { CheckoutLineInput } from '@/lib/checkout/submit'

export type CheckoutOrderType = 'purchase_order' | 'stock_on_hand'

export interface CheckoutPartition {
  orderType: CheckoutOrderType
  lines: CheckoutLineInput[]
}

/**
 * Split checkout lines into at most two homogeneous orders by fulfilment.
 * A line joins the 'stock_on_hand' partition iff its fulfilment_type is
 * exactly 'stocked' (a stock DRAW). 'made_to_order' AND absent/legacy lines
 * join 'purchase_order' — matching submit_b2b_order's MOQ-conservative
 * treatment of an absent fulfilment_type. purchase_order is returned first
 * (the primary/tracked order), then stock_on_hand. Never returns an
 * empty-lines partition; returns [] for empty input.
 */
export function partitionCheckoutLines(
  lines: CheckoutLineInput[],
): CheckoutPartition[] {
  const purchaseOrder: CheckoutLineInput[] = []
  const stockOnHand: CheckoutLineInput[] = []
  for (const line of lines) {
    if (line.fulfilment_type === 'stocked') stockOnHand.push(line)
    else purchaseOrder.push(line)
  }
  const out: CheckoutPartition[] = []
  if (purchaseOrder.length > 0) out.push({ orderType: 'purchase_order', lines: purchaseOrder })
  if (stockOnHand.length > 0) out.push({ orderType: 'stock_on_hand', lines: stockOnHand })
  return out
}
