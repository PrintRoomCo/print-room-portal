/**
 * DUPLICATE of print-room-staff-portal/src/lib/monday/production-job.ts.
 * Kept in sync manually for v1 (per customer-b2b-checkout-mvp spec §4.3).
 * Follow-up (v1.1): extract to a shared package.
 */
import { mondayApiCall } from './client'
import { PRODUCTION_BOARD_ID, PRODUCTION_COLUMNS, PRODUCTION_SUBITEM_COLUMNS } from './column-ids'

interface ProductionOrder {
  order_ref: string
  customer_name: string
  customer_email: string | null
  total_price: number
  required_by: string | null
  payment_terms: string | null
  notes: string | null
  monday_item_id: string | null
}

interface ProductionLine {
  quote_item_id: string
  product_name: string
  variant_label: string
  quantity: number
  unit_price: number
  decoration_summary: string | null
  existing_subitem_id: string | null
}

export async function createMondayProductionItem(order: ProductionOrder): Promise<{ itemId: string }> {
  if (order.monday_item_id) return { itemId: order.monday_item_id }

  const columnValues: Record<string, unknown> = {}
  columnValues[PRODUCTION_COLUMNS.customerEmail] = order.customer_email
    ? { email: order.customer_email, text: order.customer_email } : null
  columnValues[PRODUCTION_COLUMNS.quoteTotal] = order.total_price
  if (order.required_by) {
    columnValues[PRODUCTION_COLUMNS.inHandDate] = { date: order.required_by }
  }

  const mutation = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }
  `
  const result = await mondayApiCall<{ create_item: { id: string } }>(mutation, {
    boardId: String(PRODUCTION_BOARD_ID),
    itemName: `${order.order_ref} — ${order.customer_name}`,
    columnValues: JSON.stringify(columnValues),
  })
  return { itemId: result.create_item.id }
}

export async function createMondayProductionSubitem(
  parentItemId: string,
  line: ProductionLine
): Promise<{ subitemId: string }> {
  if (line.existing_subitem_id) return { subitemId: line.existing_subitem_id }

  const mutation = `
    mutation ($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
      create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }
  `
  const result = await mondayApiCall<{ create_subitem: { id: string } }>(mutation, {
    parentItemId,
    itemName: `${line.product_name} — ${line.variant_label} × ${line.quantity}`,
    columnValues: JSON.stringify({}),
  })
  return { subitemId: result.create_subitem.id }
}

export async function pushProductionJob(
  order: ProductionOrder,
  lines: ProductionLine[]
): Promise<{ itemId: string; subitemIds: Record<string, string> }> {
  const { itemId } = await createMondayProductionItem(order)
  const subitemIds: Record<string, string> = {}
  for (const line of lines) {
    const { subitemId } = await createMondayProductionSubitem(itemId, line)
    subitemIds[line.quote_item_id] = subitemId
    await new Promise((r) => setTimeout(r, 300))
  }
  return { itemId, subitemIds }
}
