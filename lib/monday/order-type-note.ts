/**
 * Item 11 — the fixed note stamped on a Monday order card when the order is
 * stock-on-hand, telling the floor to pull from stock rather than produce.
 * Copy is unconditional in Spec A. Purchase orders get no note.
 */
export const STOCK_ON_HAND_MONDAY_NOTE =
  'Stock-on-hand order — pull from existing stock. Do not produce. Xero draft quote raised — invoice before dispatch.'

export function stockOnHandMondayNote(
  orderType: 'stock_on_hand' | 'purchase_order',
): string | null {
  return orderType === 'stock_on_hand' ? STOCK_ON_HAND_MONDAY_NOTE : null
}
