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
