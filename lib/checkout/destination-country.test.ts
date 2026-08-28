import { describe, it, expect } from 'vitest'
import { countryCodeForDestination } from './destination-country'

describe('countryCodeForDestination', () => {
  const stores = new Map<string, string | null>([
    ['store-nz', 'NZ'],
    ['store-au', 'AU'],
    ['store-blank', null],
  ])

  it('resolves a saved store through the org store map', () => {
    expect(countryCodeForDestination({ ref: 'd1', ship_to_store_id: 'store-au' }, stores)).toBe('AU')
  })

  it('resolves an ad-hoc destination from its own address', () => {
    expect(
      countryCodeForDestination(
        { ref: 'd2', custom_address: { name: 'X', address: '1 X St', city: 'Sydney', postal_code: '2000', country: 'AU' } },
        stores,
      ),
    ).toBe('AU')
  })

  it('returns null for unknown stores and blank countries — callers must reject, not default', () => {
    expect(countryCodeForDestination({ ref: 'd3', ship_to_store_id: 'store-missing' }, stores)).toBeNull()
    expect(countryCodeForDestination({ ref: 'd4', ship_to_store_id: 'store-blank' }, stores)).toBeNull()
  })
})
