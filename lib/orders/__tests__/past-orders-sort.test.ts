import { describe, expect, it } from 'vitest'
import { sortPastOrders } from '@/lib/orders/past-orders-filter'
import type { PortalPastOrder } from '@/lib/portal-data'

function order(overrides: Partial<PortalPastOrder>): PortalPastOrder {
  return {
    orderId: 'o',
    quoteId: 'q',
    orderRef: null,
    quoteNumber: null,
    reference: null,
    status: 'shipped',
    orderType: 'purchase_order',
    customerName: null,
    customerEmail: null,
    customerCompany: null,
    subtotal: 0,
    totalAmount: 0,
    currency: 'NZD',
    pickingFee: 0,
    billed: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    tracking: null,
    ...overrides,
  }
}

describe('sortPastOrders', () => {
  const a = order({ orderId: 'a', billed: 50, createdAt: '2026-07-03T00:00:00.000Z', customerEmail: 'zoe@x.co' })
  const b = order({ orderId: 'b', billed: 200, createdAt: '2026-07-01T00:00:00.000Z', customerEmail: 'amy@x.co' })
  const c = order({ orderId: 'c', billed: 100, createdAt: '2026-07-02T00:00:00.000Z', customerEmail: null })

  it('sorts numerically by billed, both directions', () => {
    expect(sortPastOrders([a, b, c], { key: 'billed', dir: 'asc' }).map((o) => o.orderId)).toEqual(['a', 'c', 'b'])
    expect(sortPastOrders([a, b, c], { key: 'billed', dir: 'desc' }).map((o) => o.orderId)).toEqual(['b', 'c', 'a'])
  })

  it('sorts by createdAt desc (the default view order)', () => {
    expect(sortPastOrders([b, c, a], { key: 'createdAt', dir: 'desc' }).map((o) => o.orderId)).toEqual(['a', 'c', 'b'])
  })

  it('placedBy sorts null emails first ascending (empty string) and does not throw', () => {
    expect(sortPastOrders([a, b, c], { key: 'placedBy', dir: 'asc' }).map((o) => o.orderId)).toEqual(['c', 'b', 'a'])
  })

  it('orderRef falls back reference → quoteNumber when orderRef is null', () => {
    const x = order({ orderId: 'x', orderRef: 'B-2' })
    const y = order({ orderId: 'y', orderRef: null, reference: 'A-1' })
    expect(sortPastOrders([x, y], { key: 'orderRef', dir: 'asc' }).map((o) => o.orderId)).toEqual(['y', 'x'])
  })

  it('is stable on ties and does not mutate the input', () => {
    const input = [a, b, c].map((o) => order({ ...o, billed: 7 }))
    const out = sortPastOrders(input, { key: 'billed', dir: 'asc' })
    expect(out.map((o) => o.orderId)).toEqual(['a', 'b', 'c'])
    expect(out).not.toBe(input)
    expect(input.map((o) => o.orderId)).toEqual(['a', 'b', 'c'])
  })
})
