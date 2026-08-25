import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { GET } from './route'

type AnyRow = Record<string, unknown>

function makeAdmin() {
  const filters: Record<string, Array<[string, unknown]>> = {}
  const from = vi.fn((table: string) => {
    filters[table] ??= []
    const rows = () => {
      if (table === 'organization_countries') {
        return [
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
      }
      if (table === 'b2b_catalogue_items') {
        return [
          {
            id: 'item-au',
            fulfilment_type_override: 'made_to_order',
            products: { fulfilment_type: 'made_to_order' },
          },
        ]
      }
      if (table === 'b2b_catalogue_item_pricing_tiers') {
        return [{ min_quantity: 20, max_quantity: null, unit_price: 25.4 }]
      }
      if (table === 'product_pricing_tiers') {
        return [{ min_quantity: 24, max_quantity: null, unit_price: 12.5 }]
      }
      return []
    }
    const builder: AnyRow = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        filters[table].push([column, value])
        return builder
      }),
      in: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(async () => ({
        data:
          table === 'products'
            ? {
                id: 'product-1',
                name: 'Basic Tee',
                description: null,
                image_url: null,
                is_active: true,
              }
            : null,
        error: null,
      })),
      maybeSingle: vi.fn(async () => ({
        data:
          table === 'b2b_catalogue_items'
            ? { id: 'item-au', name: 'AU Tee', description: null }
            : null,
        error: null,
      })),
      order: vi.fn(async () => ({ data: rows(), error: null })),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
    }
    return builder
  })
  return { admin: { from } as never, filters }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
})

afterEach(() => {
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
})

describe('GET /api/shop/products/[id]', () => {
  it('returns only the server-resolved default-currency ladder when enabled', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const { admin, filters } = makeAdmin()
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin,
      context: { organizationId: 'org-1' },
    } as never)

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'product-1' }),
    })
    const body = await response.json()

    expect(body.currency).toBe('AUD')
    expect(body.brackets).toStrictEqual([
      { min_quantity: 20, max_quantity: null, unit_price: 25.4 },
    ])
    expect(filters.b2b_catalogue_item_pricing_tiers).toContainEqual(['currency', 'AUD'])
    expect(filters.product_pricing_tiers ?? []).toHaveLength(0)
  })
})
