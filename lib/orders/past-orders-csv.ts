import type { PortalPastOrder } from '@/lib/orders/past-orders-query'

/** quote_items columns the line-item export reads (subset). */
export interface PastOrderLineItem {
  quote_id: string | null
  product_name: string | null
  size_label: string | null
  quantity: number | null
  unit_price: number | null
  total_price: number | null
  qty_from_stock: number | null
  qty_to_make: number | null
  ship_to_store_id: string | null
}

type Cell = string | number | null | undefined

// Excel needs the BOM to detect UTF-8 on double-click; CRLF per RFC 4180.
const BOM = '\ufeff'

function csvField(value: Cell): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

const ORDER_HEADER: Cell[] = [
  'order_ref',
  'placed_at',
  'placed_by',
  'order_type',
  'status',
  'product_value_ex_gst',
  'picking_fee',
  'billed_ex_gst',
  'currency',
]

function orderCells(o: PortalPastOrder): Cell[] {
  return [
    o.orderRef ?? o.reference ?? o.quoteNumber ?? o.orderId,
    o.createdAt.slice(0, 10),
    o.customerEmail ?? '',
    o.orderType,
    o.status,
    o.subtotal,
    o.pickingFee,
    o.billed,
    o.currency,
  ]
}

export function buildOrdersCsv(orders: PortalPastOrder[]): string {
  return toCsv([ORDER_HEADER, ...orders.map(orderCells)])
}

const LINE_HEADER: Cell[] = [
  ...ORDER_HEADER,
  'product_name',
  'size_label',
  'quantity',
  'unit_price',
  'line_total',
  'qty_from_stock',
  'qty_to_make',
  'ship_to_store',
]

export function buildLineItemsCsv(
  orders: PortalPastOrder[],
  itemsByQuoteId: Map<string, PastOrderLineItem[]>,
  storeNameById: Map<string, string>,
): string {
  const rows: Cell[][] = [LINE_HEADER]
  for (const order of orders) {
    const items = (order.quoteId && itemsByQuoteId.get(order.quoteId)) || []
    if (items.length === 0) {
      // An order with no quote_items must still appear — an export that
      // silently drops orders reads as "covered everything" when it didn't.
      rows.push([...orderCells(order), '', '', '', '', '', '', '', ''])
      continue
    }
    for (const item of items) {
      rows.push([
        ...orderCells(order),
        item.product_name,
        item.size_label,
        item.quantity,
        item.unit_price,
        item.total_price,
        item.qty_from_stock,
        item.qty_to_make,
        item.ship_to_store_id
          ? (storeNameById.get(item.ship_to_store_id) ?? item.ship_to_store_id)
          : '',
      ])
    }
  }
  return toCsv(rows)
}
