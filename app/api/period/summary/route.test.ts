import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: 'org_admin' as 'org_admin' | 'staff',
  rpc: vi.fn(),
  from: vi.fn(),
  pricingFilters: [] as Array<[string, unknown]>,
}))

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: vi.fn(async () => ({
    admin: { rpc: mocks.rpc, from: mocks.from },
    context: {
      organizationId: 'org-1',
      role: mocks.role,
    },
  })),
}))

const progressRows = [
  {
    period_id: 'period-1',
    closes_at: '2026-08-21T12:00:00.000Z',
    catalogue_item_id: 'duffel-item',
    agg_qty: 0,
    order_count: 0,
    current_unit_price: 32.12,
    next_min_quantity: 24,
    next_unit_price: 32.12,
  },
]

const priceBands = [
  { catalogue_item_id: 'duffel-item', min_quantity: 1, final_unit_price: 32.12 },
  { catalogue_item_id: 'duffel-item', min_quantity: 24, final_unit_price: 32.12 },
  { catalogue_item_id: 'duffel-item', min_quantity: 50, final_unit_price: 32.12 },
  { catalogue_item_id: 'duffel-item', min_quantity: 100, final_unit_price: 30.14 },
  { catalogue_item_id: 'duffel-item', min_quantity: 250, final_unit_price: 19.15 },
]

function pricingBuilder() {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      mocks.pricingFilters.push([column, value])
      return builder
    }),
    in: vi.fn(() => builder),
    order: vi.fn(async () => ({ data: priceBands, error: null })),
  }
  return builder
}

function countryBuilder() {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown[] }) => unknown) =>
      resolve({
        data: [
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
        ],
      }),
  }
  return builder
}

async function getSummary() {
  const { GET } = await import('./route')
  return GET(
    new Request(
      'http://localhost/api/period/summary?item=duffel-item%3A48',
    ),
  )
}

describe('GET /api/period/summary', () => {
  beforeEach(() => {
    mocks.role = 'org_admin'
    mocks.pricingFilters = []
    delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
    mocks.rpc.mockResolvedValue({ data: progressRows, error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'b2b_ordering_period_item_pricing') return pricingBuilder()
      if (table === 'organization_countries') return countryBuilder()
      throw new Error(`Unexpected table: ${table}`)
    })
  })

  afterEach(() => {
    delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
  })

  it('uses cart quantity and skips boundaries without a price drop', async () => {
    const response = await getSummary()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toEqual([
      expect.objectContaining({
        catalogueItemId: 'duffel-item',
        aggQty: 0,
        unitsToNextBreak: 52,
        currentUnitPrice: 32.12,
        nextUnitPrice: 30.14,
        perUnitSavings: 1.98,
        franchiseSavings: 95.04,
      }),
    ])
  })

  it('keeps the raw network aggregate hidden from regular staff', async () => {
    mocks.role = 'staff'
    const response = await getSummary()
    const body = await response.json()
    expect(body.items[0].aggQty).toBeNull()
    expect(body.items[0].unitsToNextBreak).toBe(52)
    expect(body.items[0].franchiseSavings).toBe(95.04)
  })

  it('resolves and filters the authored default currency without trusting the request', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        'http://localhost/api/period/summary?item=duffel-item%3A48&currency=NZD',
      ),
    )

    const body = await response.json()
    expect(body.currency).toBe('AUD')
    expect(mocks.pricingFilters).toContainEqual(['currency', 'AUD'])
    expect(mocks.pricingFilters).not.toContainEqual(['currency', 'NZD'])
  })
})
