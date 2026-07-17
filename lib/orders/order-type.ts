// Foundation F-1 — order-type classification.
// Derived from the cart's per-line fulfilment_type at submit time. An order is
// 'stock_on_hand' only when EVERY line is a genuine stock draw ('stocked');
// any made_to_order line (or an absent/legacy fulfilment_type) makes the whole
// order a 'purchase_order'. This is the all-stocked twin of the drawsStock
// predicate (some-stocked) at lib/checkout/submit.ts step 5c.
// Interim rule (Spec A): a mixed cart stays ONE order classified
// 'purchase_order'; Spec B F1 will split mixed carts.

export type OrderType = 'stock_on_hand' | 'purchase_order'

export interface ClassifiableLine {
  fulfilment_type?: 'stocked' | 'made_to_order' | null
}

export function classifyOrderType(
  lines: ReadonlyArray<ClassifiableLine>,
): OrderType {
  if (lines.length === 0) return 'purchase_order'
  return lines.every((l) => l.fulfilment_type === 'stocked')
    ? 'stock_on_hand'
    : 'purchase_order'
}

export function orderTypeLabel(type: string): string {
  return type === 'stock_on_hand' ? 'Stock' : 'Purchase order'
}
