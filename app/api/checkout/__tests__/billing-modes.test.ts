import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireB2BCustomerApi: vi.fn(),
  resolveLineBillingModes: vi.fn(),
}))

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: mocks.requireB2BCustomerApi,
}))
vi.mock('@/lib/checkout/resolve-line-billing-modes', () => ({
  resolveLineBillingModes: mocks.resolveLineBillingModes,
}))

import { GET } from '../billing-modes/route'

const admin = { from: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireB2BCustomerApi.mockResolvedValue({
    admin,
    context: { organizationId: 'org-1' },
  })
  mocks.resolveLineBillingModes.mockResolvedValue(new Map([['v1', 'prepaid']]))
})

function req(qs: string) {
  return new Request(`http://localhost/api/checkout/billing-modes${qs}`)
}

describe('GET /api/checkout/billing-modes', () => {
  it('returns the fresh mode map for the requested variants', async () => {
    const res = await GET(req('?variant_ids=v1,v2'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ modeByVariantId: { v1: 'prepaid' } })
  })

  it('scopes the read to the CALLER org, never a client-supplied one', async () => {
    await GET(req('?variant_ids=v1&organization_id=someone-else'))
    expect(mocks.resolveLineBillingModes).toHaveBeenCalledWith(admin, 'org-1', ['v1'])
  })

  it('dedupes and trims the variant ids', async () => {
    await GET(req('?variant_ids=v1,%20v1%20,v2,'))
    expect(mocks.resolveLineBillingModes).toHaveBeenCalledWith(admin, 'org-1', ['v1', 'v2'])
  })

  it('returns an empty map for no variant ids without hitting the DB', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ modeByVariantId: {} })
    expect(mocks.resolveLineBillingModes).not.toHaveBeenCalled()
  })

  it('rejects an over-long variant list rather than issuing an unbounded IN', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `v${i}`).join(',')
    const res = await GET(req(`?variant_ids=${ids}`))
    expect(res.status).toBe(400)
    expect(mocks.resolveLineBillingModes).not.toHaveBeenCalled()
  })

  it('propagates the auth failure response', async () => {
    const error = new Response(null, { status: 401 })
    mocks.requireB2BCustomerApi.mockResolvedValue({ error })
    expect(await GET(req('?variant_ids=v1'))).toBe(error)
  })
})
