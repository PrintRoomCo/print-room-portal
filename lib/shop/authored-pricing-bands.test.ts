import { describe, expect, it, vi } from 'vitest'
import { loadAuthoredPricingBands } from './authored-pricing-bands'

function fakeSupabaseQuery(args: {
  filters: Array<[string, unknown]>
  data: Array<{ min_quantity: number; max_quantity: number | null }>
}) {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn((key: string, value: unknown) => {
      args.filters.push([key, value])
      return builder
    }),
    order: vi.fn(async () => ({ data: args.data, error: null })),
  }
  return builder
}

describe('loadAuthoredPricingBands', () => {
  it('pins the SP2 pre-cutover authored ladder to NZD', async () => {
    const filters: Array<[string, unknown]> = []
    const admin = fakeSupabaseQuery({
      filters,
      data: [{ min_quantity: 24, max_quantity: null }],
    })

    expect(await loadAuthoredPricingBands(admin as never, 'item-1')).toEqual([
      { min_quantity: 24, max_quantity: null },
    ])
    expect(filters).toContainEqual(['catalogue_item_id', 'item-1'])
    expect(filters).toContainEqual(['currency', 'NZD'])
  })

  it('loads only the independently authored target-currency ladder when enabled', async () => {
    const filters: Array<[string, unknown]> = []
    const admin = fakeSupabaseQuery({
      filters,
      data: [
        { min_quantity: 20, max_quantity: 74 },
        { min_quantity: 75, max_quantity: null },
      ],
    })

    await expect(loadAuthoredPricingBands(admin as never, 'item-au', 'AUD', true)).resolves.toEqual([
      { min_quantity: 20, max_quantity: 74 },
      { min_quantity: 75, max_quantity: null },
    ])
    expect(filters).toContainEqual(['currency', 'AUD'])
    expect(filters).not.toContainEqual(['currency', 'NZD'])
  })
})
