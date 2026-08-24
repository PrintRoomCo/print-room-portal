import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { POST } from './route'

type Row = Record<string, unknown>

function request(body: unknown) {
  return new Request('http://localhost/api/shop/pricing', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function adminStub(rpcData: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: null })
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = []
    const builder: Row = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([column, value])
        return builder
      }),
      lte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({
        data:
          table === 'b2b_catalogue_items'
            ? { id: 'item-au' }
            : table === 'b2b_catalogue_item_pricing_tiers'
              ? { min_quantity: 20, max_quantity: 99 }
              : table === 'product_pricing_tiers'
                ? { min_quantity: 24, max_quantity: 49 }
                : null,
        error: null,
      })),
      then: (resolve: (value: { data: unknown[] }) => unknown) =>
        resolve({
          data:
            table === 'organization_countries'
              ? [
                  {
                    country_code: 'AU',
                    is_default: true,
                    countries: {
                      name: 'Australia',
                      currency: 'AUD',
                      tax_rate: 0.1,
                      tax_label: 'GST 10%',
                    },
                  },
                ]
              : [],
        }),
    }
    return builder
  })
  return { admin: { from, rpc } as never, from, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
})

afterEach(() => {
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
})

describe('POST /api/shop/pricing', () => {
  it('uses the exact server-resolved default currency and preserves authored zero', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const { admin, rpc } = adminStub(0)
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin,
      context: { organizationId: 'org-1' },
    } as never)

    const response = await POST(
      request({
        product_id: 'product-1',
        catalogue_item_id: 'item-au',
        qty: 20,
        currency: 'NZD',
      }),
    )

    await expect(response.json()).resolves.toStrictEqual({
      unit_price: 0,
      total: 0,
      status: 'ok',
      bracket: { min_quantity: 20, max_quantity: 99 },
      currency: 'AUD',
    })
    expect(rpc).toHaveBeenCalledWith('effective_unit_price_for_item_currency', {
      p_catalogue_item_id: 'item-au',
      p_org_id: 'org-1',
      p_qty: 20,
      p_currency: 'AUD',
    })
    expect(rpc.mock.calls.some(([name]) => name === 'effective_unit_price')).toBe(false)
  })

  it('keeps the legacy RPC arguments and response shape byte-identical when disabled', async () => {
    const { admin, rpc } = adminStub(12.5)
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin,
      context: { organizationId: 'org-1' },
    } as never)

    const response = await POST(
      request({ product_id: 'product-1', catalogue_item_id: 'item-au', qty: 24 }),
    )

    await expect(response.json()).resolves.toStrictEqual({
      unit_price: 12.5,
      total: 300,
      status: 'ok',
      bracket: { min_quantity: 24, max_quantity: 49 },
    })
    expect(rpc).toHaveBeenCalledWith('effective_unit_price', {
      p_product_id: 'product-1',
      p_org_id: 'org-1',
      p_qty: 24,
    })
  })
})
