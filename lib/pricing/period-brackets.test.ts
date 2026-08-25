import { describe, expect, it, vi } from 'vitest'

import {
  exactPdpBrackets,
  getPeriodBracketsForItem,
} from './period-brackets'

function periodAdmin(data: unknown[]) {
  const filters: Array<[string, unknown]> = []
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      return query
    }),
    order: vi.fn(async () => ({ data })),
  }
  return { admin: { from: vi.fn(() => query) } as never, filters }
}

describe('getPeriodBracketsForItem', () => {
  it('filters the period snapshot by exact destination currency when enabled', async () => {
    const { admin, filters } = periodAdmin([
      { min_quantity: 20, max_quantity: 99, final_unit_price: 0 },
      { min_quantity: 100, max_quantity: null, final_unit_price: 8.5 },
    ])

    await expect(
      getPeriodBracketsForItem(admin, 'period-1', 'item-1', 'AUD', true),
    ).resolves.toStrictEqual([
      { minQty: 20, maxQty: 99, unitPrice: 0 },
      { minQty: 100, maxQty: null, unitPrice: 8.5 },
    ])
    expect(filters).toContainEqual(['currency', 'AUD'])
  })

  it('keeps the flag-off period query byte-identical', async () => {
    const { admin, filters } = periodAdmin([])
    await getPeriodBracketsForItem(admin, 'period-1', 'item-1', 'AUD', false)
    expect(filters).toStrictEqual([
      ['period_id', 'period-1'],
      ['catalogue_item_id', 'item-1'],
    ])
  })
})

describe('exactPdpBrackets', () => {
  it('does not fall back to live tiers when an open pre-order snapshot is empty', () => {
    expect(exactPdpBrackets({
      liveBrackets: [{ min_quantity: 1, max_quantity: null, unit_price: 99 }],
      periodBrackets: [],
      usesPeriodSnapshot: true,
    })).toEqual([])
  })
})
