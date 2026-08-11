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
  class BillingModeDriftError extends Error {}
  return {
    DecorationDriftError, UnitPriceDriftError, MemberAccessDriftError,
    MoqViolationError, StockShortfallError, BuyerScopeError, MixedShippingAddressError,
    BillingModeDriftError,
    submitCustomerOrder: vi.fn(),
  }
})

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { submitCustomerOrder } from '@/lib/checkout/submit'

function req(body: unknown): Request {
  return new Request('http://t/api/checkout', { method: 'POST', body: JSON.stringify(body) })
}

// All-null ship-to + custom address so validation passes without a store list.
const baseBody = {
  idempotency_key: 'idem-terms',
  lines: [{ product_id: 'p1', product_name: 'Staple Tee', qty: 10, fulfilment_type: 'stocked' }],
  custom_shipping_address: { line1: '1 Test St' },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireB2BCustomerApi).mockResolvedValue({
    admin: {} as never,
    context: { storeIds: [], role: 'org_admin', tenantType: 'franchise', organizationId: 'o1' } as never,
  })
})

describe('POST /api/checkout — Terms & Conditions gate', () => {
  it('returns 400 terms_not_accepted when terms_accepted is missing', async () => {
    const res = await POST(req({ ...baseBody, terms_version: 'v1-2026-08-11' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('terms_not_accepted')
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })

  it('returns 400 terms_not_accepted when terms_accepted is false', async () => {
    const res = await POST(req({ ...baseBody, terms_accepted: false, terms_version: 'v1-2026-08-11' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('terms_not_accepted')
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })

  it('returns 400 terms_not_accepted when terms_version is missing or empty', async () => {
    const res = await POST(req({ ...baseBody, terms_accepted: true, terms_version: '   ' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('terms_not_accepted')
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })

  it('threads terms_accepted + terms_version into submitCustomerOrder on the happy path', async () => {
    vi.mocked(submitCustomerOrder).mockResolvedValueOnce({ order_id: 'o-1', order_ref: 'O-1' })
    const res = await POST(req({ ...baseBody, terms_accepted: true, terms_version: 'v1-2026-08-11' }))
    expect(res.status).toBe(200)
    expect(submitCustomerOrder).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(submitCustomerOrder).mock.calls[0][1]
    expect(arg.terms_accepted).toBe(true)
    expect(arg.terms_version).toBe('v1-2026-08-11')
  })
})
