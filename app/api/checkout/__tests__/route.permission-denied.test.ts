import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: vi.fn(),
}))

// Keep real domain-error classes so the route's instanceof checks behave; only
// submitCustomerOrder is overridden.
vi.mock('@/lib/checkout/submit', () => {
  class DecorationDriftError extends Error {}
  class UnitPriceDriftError extends Error {}
  class MemberAccessDriftError extends Error {}
  class MoqViolationError extends Error {}
  class StockShortfallError extends Error {}
  class BuyerScopeError extends Error {}
  class MixedShippingAddressError extends Error {}
  class DisabledCountryError extends Error {}
  class BillingModeDriftError extends Error {}
  class MinimumOrderValueError extends Error {}
  return {
    DecorationDriftError, UnitPriceDriftError, MemberAccessDriftError,
    MoqViolationError, StockShortfallError, BuyerScopeError, MixedShippingAddressError,
    DisabledCountryError,
    BillingModeDriftError,
    MinimumOrderValueError,
    submitCustomerOrder: vi.fn(),
  }
})

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { submitCustomerOrder } from '@/lib/checkout/submit'

function req(body: unknown): Request {
  return new Request('http://t/api/checkout', { method: 'POST', body: JSON.stringify(body) })
}

const VALID_BODY = {
  idempotency_key: 'idem-1',
  lines: [{ product_id: 'p1', product_name: 'Staple Tee', qty: 10 }],
  custom_shipping_address: { line1: '1 Test St' },
  terms_accepted: true, terms_version: 'v1-2026-08-11',
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
  vi.mocked(requireB2BCustomerApi).mockResolvedValue({
    admin: {} as never,
    context: { storeIds: [], role: 'org_admin', tenantType: 'franchise', organizationId: 'o1' } as never,
  })
})

describe('POST /api/checkout — PERMISSION_DENIED mapping', () => {
  it('returns 403 (not 500) when submit raises PERMISSION_DENIED', async () => {
    vi.mocked(submitCustomerOrder).mockRejectedValue(new Error('PERMISSION_DENIED'))

    const res = await POST(req(VALID_BODY))

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('PERMISSION_DENIED')
  })

  it('still returns 500 for a genuinely unexpected error', async () => {
    vi.mocked(submitCustomerOrder).mockRejectedValue(new Error('kaboom'))

    const res = await POST(req(VALID_BODY))

    expect(res.status).toBe(500)
  })
})
