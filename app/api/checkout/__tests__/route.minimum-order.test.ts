import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

const submitMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/checkout/submit', async () => {
  const errors = await import('@/lib/checkout/errors')
  return {
    ...errors,
    submitCustomerOrder: submitMock,
  }
})

import { MinimumOrderValueError } from '@/lib/checkout/errors'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { POST } from '../route'

const GATED = {
  applies: true,
  met: false,
  threshold: 500,
  currency: 'NZD',
  value: 380,
  shortfall: 120,
}

function body() {
  return {
    idempotency_key: 'idem-1',
    terms_accepted: true,
    terms_version: 'v1',
    lines: [
      {
        product_id: 'p1',
        product_name: 'Tee',
        variant_id: 'v1',
        qty: 10,
        unit_price: 38,
        fulfilment_type: 'made_to_order',
        decorations: [],
        ship_to_store_id: 'store-1',
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireB2BCustomerApi).mockResolvedValue({
    admin: { from: vi.fn(), rpc: vi.fn() },
    context: {
      organizationId: 'org-1',
      customerCode: 'ACME',
      role: 'org_admin',
      storeIds: ['store-1'],
      branchStoreIds: [],
      defaultStoreId: null,
      orderingPermission: 'both',
    },
  } as unknown as Awaited<ReturnType<typeof requireB2BCustomerApi>>)
})

describe('POST /api/checkout minimum order value', () => {
  it('returns 422 with the code, the status and the customer message', async () => {
    submitMock.mockRejectedValue(new MinimumOrderValueError(GATED))

    const res = await POST(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body()),
      }),
    )

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('minimum_order_value')
    expect(json.status).toEqual(GATED)
    expect(json.message).toContain('$500 minimum')
  })
})
