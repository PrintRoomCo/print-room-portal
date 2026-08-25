import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { POST } from '../route'

type Row = Record<string, unknown>

function makeAdmin() {
  const rpcCalls: Array<{ name: string; args: Row | undefined }> = []

  function builderFor(table: string) {
    let selection = ''
    const builder = {
      select: vi.fn((value: string) => {
        selection = value
        return builder
      }),
      eq: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      in: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      order: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        if (table === 'b2b_catalogue_items' && selection.includes('b2b_catalogues!inner')) {
          return { data: { id: 'item-1' }, error: null }
        }
        if (table === 'b2b_ordering_periods') {
          return {
            data: { id: 'period-1', closes_at: '2099-01-01T00:00:00.000Z' },
            error: null,
          }
        }
        if (table === 'b2b_catalogue_item_pricing_tiers') {
          return { data: { min_quantity: 1, max_quantity: null }, error: null }
        }
        return { data: null, error: null }
      }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        const data =
          table === 'organization_countries'
            ? [{
                country_code: 'AU',
                is_default: true,
                countries: {
                  name: 'Australia', currency: 'AUD', tax_rate: 0.1, tax_label: 'GST 10%',
                },
              }]
            : table === 'b2b_catalogue_items'
              ? [{
                  id: 'item-1',
                  fulfilment_type_override: 'pre_order',
                  products: { fulfilment_type: 'made_to_order' },
                }]
              : table === 'b2b_ordering_period_item_pricing'
                ? [{ min_quantity: 10, max_quantity: 49, final_unit_price: 12 }]
                : []
        return resolve({ data, error: null })
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args?: Row) => {
      rpcCalls.push({ name, args })
      if (name === 'effective_unit_price_for_item_currency') {
        return { data: 99, error: null }
      }
      return { data: null, error: null }
    }),
  }
  return { admin, rpcCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
})

afterEach(() => {
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
})

describe('POST /api/shop/pricing', () => {
  it('reprices a pre-order item from its exact-currency period snapshot', async () => {
    const { admin, rpcCalls } = makeAdmin()
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: { organizationId: 'org-1' } as never,
    })

    const response = await POST(new Request('http://localhost/api/shop/pricing', {
      method: 'POST',
      body: JSON.stringify({ product_id: 'product-1', catalogue_item_id: 'item-1', qty: 12 }),
    }))

    await expect(response.json()).resolves.toEqual({
      unit_price: 12,
      total: 144,
      status: 'ok',
      bracket: { min_quantity: 10, max_quantity: 49 },
      currency: 'AUD',
    })
    expect(rpcCalls).not.toContainEqual(expect.objectContaining({
      name: 'effective_unit_price_for_item_currency',
    }))
  })
})
