import { describe, it, expect } from 'vitest'
import { parseShopFilters, activeFilterCount, DEFAULT_SHOP_FILTERS } from '../filter-params'

describe('shop filters — ordering mode', () => {
  it('defaults to all', () => {
    expect(DEFAULT_SHOP_FILTERS.mode).toBe('all')
    expect(parseShopFilters({}).mode).toBe('all')
  })
  it('parses the mode query key', () => {
    expect(parseShopFilters({ mode: 'from_inventory' }).mode).toBe('from_inventory')
    expect(parseShopFilters({ mode: 'reorder' }).mode).toBe('reorder')
  })
  it('rejects an unknown mode → all', () => {
    expect(parseShopFilters({ mode: 'banana' }).mode).toBe('all')
  })
  it('counts a non-all mode as an active filter', () => {
    expect(activeFilterCount({ ...DEFAULT_SHOP_FILTERS, mode: 'reorder' })).toBe(1)
    expect(activeFilterCount({ ...DEFAULT_SHOP_FILTERS, mode: 'all' })).toBe(0)
  })
})
