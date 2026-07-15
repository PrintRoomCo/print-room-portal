import { describe, it, expect } from 'vitest'
import { withinDateRange, filterPastOrders } from '../past-orders-filter'
import type { PortalPastOrder } from '@/lib/portal-data'

function order(over: Partial<PortalPastOrder>): PortalPastOrder {
  return {
    orderId: over.orderId ?? 'o',
    quoteId: null,
    orderRef: null,
    quoteNumber: null,
    reference: null,
    status: over.status ?? 'shipped',
    customerName: null,
    customerEmail: null,
    customerCompany: null,
    subtotal: 0,
    totalAmount: 0,
    currency: 'NZD',
    createdAt: over.createdAt ?? '2026-05-15T10:00:00.000Z',
    tracking: null,
  }
}

describe('withinDateRange', () => {
  it('is inclusive of both bounds on the date portion', () => {
    expect(withinDateRange('2026-05-15T23:59:00Z', '2026-05-15', '2026-05-15')).toBe(true)
    expect(withinDateRange('2026-05-14T00:00:00Z', '2026-05-15', null)).toBe(false)
    expect(withinDateRange('2026-05-16T00:00:00Z', null, '2026-05-15')).toBe(false)
  })
  it('treats null bounds as open', () => {
    expect(withinDateRange('2026-01-01T00:00:00Z', null, null)).toBe(true)
  })
})

describe('filterPastOrders', () => {
  const orders = [
    order({ orderId: 'a', status: 'shipped', createdAt: '2026-05-10T00:00:00Z' }),
    order({ orderId: 'b', status: 'in-production', createdAt: '2026-05-20T00:00:00Z' }),
  ]
  it('status "all" keeps everything', () => {
    expect(filterPastOrders(orders, { status: 'all', from: null, to: null })).toHaveLength(2)
  })
  it('filters by exact status', () => {
    expect(filterPastOrders(orders, { status: 'shipped', from: null, to: null }).map((o) => o.orderId)).toEqual(['a'])
  })
  it('filters by date range', () => {
    expect(filterPastOrders(orders, { status: 'all', from: '2026-05-15', to: null }).map((o) => o.orderId)).toEqual(['b'])
  })
})

describe('tracker date filter reuse', () => {
  it('keeps a tracker created inside the range', () => {
    expect(withinDateRange('2026-06-01T08:00:00Z', '2026-06-01', '2026-06-30')).toBe(true)
  })
  it('drops a tracker created before the range', () => {
    expect(withinDateRange('2026-05-31T23:00:00Z', '2026-06-01', null)).toBe(false)
  })
})
