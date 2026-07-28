import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: 'org_admin' as 'org_admin' | 'staff',
  rpc: vi.fn(),
  from: vi.fn(),
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
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(async () => ({ data: priceBands, error: null })),
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
    mocks.rpc.mockResolvedValue({ data: progressRows, error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'b2b_ordering_period_item_pricing') return pricingBuilder()
      throw new Error(`Unexpected table: ${table}`)
    })
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
})
