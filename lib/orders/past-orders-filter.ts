import type { PortalPastOrder } from '@/lib/portal-data'

export interface PastOrderFilters {
  status: string // 'all' or an order_status value
  from: string | null // 'yyyy-mm-dd' inclusive
  to: string | null // 'yyyy-mm-dd' inclusive
}

/** Inclusive date-range test on the date portion of an ISO timestamp. */
export function withinDateRange(iso: string, from: string | null, to: string | null): boolean {
  const day = iso.slice(0, 10)
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

export function filterPastOrders(orders: PortalPastOrder[], f: PastOrderFilters): PortalPastOrder[] {
  return orders.filter((o) => {
    if (f.status !== 'all' && o.status !== f.status) return false
    return withinDateRange(o.createdAt, f.from, f.to)
  })
}

export type PastOrderSortKey =
  | 'createdAt'
  | 'orderRef'
  | 'placedBy'
  | 'orderType'
  | 'status'
  | 'productValue'
  | 'billed'

export interface PastOrderSort {
  key: PastOrderSortKey
  dir: 'asc' | 'desc'
}

const SORT_VALUE: Record<PastOrderSortKey, (o: PortalPastOrder) => string | number> = {
  createdAt: (o) => o.createdAt,
  orderRef: (o) => o.orderRef ?? o.reference ?? o.quoteNumber ?? '',
  placedBy: (o) => o.customerEmail ?? '',
  orderType: (o) => o.orderType,
  status: (o) => o.status,
  productValue: (o) => o.subtotal,
  billed: (o) => o.billed,
}

/** Non-mutating; Array.prototype.sort is stable, so ties keep fetch order. */
export function sortPastOrders(orders: PortalPastOrder[], sort: PastOrderSort): PortalPastOrder[] {
  const value = SORT_VALUE[sort.key]
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...orders].sort((x, y) => {
    const vx = value(x)
    const vy = value(y)
    if (vx === vy) return 0
    if (typeof vx === 'number' && typeof vy === 'number') return (vx - vy) * sign
    return String(vx).localeCompare(String(vy)) * sign
  })
}
