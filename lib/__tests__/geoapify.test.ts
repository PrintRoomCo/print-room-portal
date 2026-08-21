import { describe, expect, it } from 'vitest'
import { getStreetAddress, getSuggestionLabel, parseSuggestion } from '@/lib/address/geoapify'

describe('parseSuggestion', () => {
  it('maps a full Geoapify result to the AddressPlace shape with ISO country', () => {
    expect(
      parseSuggestion({
        housenumber: '12',
        street: 'Queen Street',
        city: 'Auckland',
        state_code: 'AUK',
        postcode: '1010',
        country_code: 'nz',
        address_line1: '12 Queen Street',
      }),
    ).toEqual({
      address: '12 Queen Street',
      city: 'Auckland',
      state: 'AUK',
      postal_code: '1010',
      country: 'NZ',
    })
  })

  it('falls back through town/village/suburb/county for the city', () => {
    expect(parseSuggestion({ town: 'Cambridge', country_code: 'nz' }).city).toBe('Cambridge')
    expect(parseSuggestion({ suburb: 'Ponsonby', country_code: 'nz' }).city).toBe('Ponsonby')
  })
})

describe('getStreetAddress', () => {
  it('prefers address_line1, then housenumber + street, then formatted', () => {
    expect(getStreetAddress({ address_line1: '1 High St', formatted: 'x' })).toBe('1 High St')
    expect(getStreetAddress({ housenumber: '1', street: 'High St' })).toBe('1 High St')
    expect(getStreetAddress({ formatted: '1 High St, Auckland' })).toBe('1 High St, Auckland')
  })
})

describe('getSuggestionLabel', () => {
  it('uses formatted, else joins address lines', () => {
    expect(getSuggestionLabel({ formatted: 'A, B' })).toBe('A, B')
    expect(getSuggestionLabel({ address_line1: 'A', address_line2: 'B' })).toBe('A, B')
  })
})
