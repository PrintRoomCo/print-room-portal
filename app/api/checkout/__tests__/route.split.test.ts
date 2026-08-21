import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))
vi.mock('@/lib/checkout/submit', () => {
  class DecorationDriftError extends Error {}
  class UnitPriceDriftError extends Error {}
  class MemberAccessDriftError extends Error {}
  class MoqViolationError extends Error {}
  class StockShortfallError extends Error {}
  class BuyerScopeError extends Error {}
  class MixedShippingAddressError extends Error {}
  class DisabledCountryError extends Error {}
  return {
    DecorationDriftError, UnitPriceDriftError, MemberAccessDriftError,
    MoqViolationError, StockShortfallError, BuyerScopeError, MixedShippingAddressError,
    DisabledCountryError,
    submitCustomerOrder: vi.fn(),
  }
})

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { submitCustomerOrder } from '@/lib/checkout/submit'

function req(body: unknown): Request {
  return new Request('http://t/api/checkout', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireB2BCustomerApi).mockResolvedValue({
    admin: {} as never,
    context: { storeIds: ['s1'], role: 'org_admin', tenantType: 'franchise', organizationId: 'o1' } as never,
  })
})

describe('POST /api/checkout — mixed-cart split', () => {
  it('creates two orders (purchase_order + stock_on_hand) with distinct idempotency keys', async () => {
    vi.mocked(submitCustomerOrder)
      .mockResolvedValueOnce({ order_id: 'po-1', order_ref: 'PO-1' })
      .mockResolvedValueOnce({ order_id: 'st-1', order_ref: 'ST-1' })

    const res = await POST(req({
      idempotency_key: 'idem-1',
      lines: [
        { product_id: 'mto', product_name: 'Tee', qty: 10, ship_to_store_id: 's1', fulfilment_type: 'made_to_order' },
        { product_id: 'stk', product_name: 'Cap', qty: 5, ship_to_store_id: 's1', fulfilment_type: 'stocked' },
      ],
      terms_accepted: true, terms_version: 'v1-2026-08-11',
    }))

    expect(res.status).toBe(200)
    expect(submitCustomerOrder).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(submitCustomerOrder).mock.calls
    // purchase_order partition first (per partitionCheckoutLines), distinct suffix
    expect(calls[0][1].idempotency_key).toBe('idem-1:po')
    expect(calls[0][1].lines.map((l) => l.product_id)).toEqual(['mto'])
    expect(calls[1][1].idempotency_key).toBe('idem-1:stock')
    expect(calls[1][1].lines.map((l) => l.product_id)).toEqual(['stk'])
    // Reconciliation: order_type is NOT passed to submit (it self-classifies);
    // the partition orderType surfaces only in the response.
    expect('order_type' in calls[0][1]).toBe(false)
    // Volume-tier pooling: each partition call carries the FULL cart as
    // pricing_pool_lines so a product whose qty spans both partitions still
    // prices at the pooled tier (matching the cart's claimed price).
    expect(calls[0][1].pricing_pool_lines?.map((l: { product_id: string }) => l.product_id)).toEqual(['mto', 'stk'])
    expect(calls[1][1].pricing_pool_lines?.map((l: { product_id: string }) => l.product_id)).toEqual(['mto', 'stk'])

    const json = await res.json()
    expect(json.order_id).toBe('po-1')
    expect(json.orders).toHaveLength(2)
    expect(json.orders.map((o: { order_type: string }) => o.order_type)).toEqual(['purchase_order', 'stock_on_hand'])
  })

  it('makes a single submit call for an all-stock cart', async () => {
    vi.mocked(submitCustomerOrder).mockResolvedValueOnce({ order_id: 'st-1', order_ref: 'ST-1' })
    const res = await POST(req({
      idempotency_key: 'idem-2',
      lines: [{ product_id: 'stk', product_name: 'Cap', qty: 5, ship_to_store_id: 's1', fulfilment_type: 'stocked' }],
      terms_accepted: true, terms_version: 'v1-2026-08-11',
    }))
    expect(res.status).toBe(200)
    expect(submitCustomerOrder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitCustomerOrder).mock.calls[0][1].idempotency_key).toBe('idem-2:stock')
    const json = await res.json()
    expect(json.orders.map((o: { order_type: string }) => o.order_type)).toEqual(['stock_on_hand'])
  })
})
