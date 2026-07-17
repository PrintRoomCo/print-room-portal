import { describe, it, expect } from 'vitest'
import { resolveShipCountry } from './ship-country'

const stores = new Map<string, string | null>([
  ['store-nz', 'NZ'],
  ['store-au', 'Australia'],
  ['store-blank', null],
])

describe('resolveShipCountry', () => {
  it("uses the FIRST STOCKED line's store, not the first cart line", () => {
    // The stocked partition submits as its own order, so a made-to-order line
    // sitting first in the cart must not decide the stock order's fee gate.
    expect(
      resolveShipCountry({
        lines: [
          { lineId: 'a', fulfilmentType: 'made_to_order' },
          { lineId: 'b', fulfilmentType: 'stocked' },
        ],
        perLineShipTo: { a: 'store-au', b: 'store-nz' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBe('NZ')
  })

  it('uses the custom address country when every line ships custom', () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'stocked' }],
        perLineShipTo: { a: null },
        customAddressCountry: 'New Zealand',
        countryByStoreId: stores,
      }),
    ).toBe('New Zealand')
  })

  it('takes the first stocked line that HAS a store when custom and store are mixed', () => {
    // v1 rejects mixed custom/store carts at the API, but the resolver must
    // still return something coherent rather than null.
    expect(
      resolveShipCountry({
        lines: [
          { lineId: 'a', fulfilmentType: 'stocked' },
          { lineId: 'b', fulfilmentType: 'stocked' },
        ],
        perLineShipTo: { a: null, b: 'store-nz' },
        customAddressCountry: 'NZ',
        countryByStoreId: stores,
      }),
    ).toBe('NZ')
  })

  it('is null when there is no stocked line (purchase order — no fee anyway)', () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'made_to_order' }],
        perLineShipTo: { a: 'store-nz' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })

  it("is null when the stocked line's store has no country recorded", () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'stocked' }],
        perLineShipTo: { a: 'store-blank' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })

  it('is null for an unknown store id', () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'stocked' }],
        perLineShipTo: { a: 'store-gone' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })

  it('is null for an empty cart', () => {
    expect(
      resolveShipCountry({
        lines: [],
        perLineShipTo: {},
        customAddressCountry: 'NZ',
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })

  it('passes an AUS ship-to through unchanged (the fee gate rejects it downstream)', () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'stocked' }],
        perLineShipTo: { a: 'store-au' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBe('Australia')
  })
})
