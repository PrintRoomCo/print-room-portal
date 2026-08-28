import { describe, it, expect } from 'vitest'
import { mapPlaceToCustomAddress } from './places'

const wellington = [
  { types: ['street_number'], longText: '12' },
  { types: ['route'], longText: 'Cuba Street' },
  { types: ['sublocality_level_1', 'sublocality'], longText: 'Te Aro' },
  { types: ['locality'], longText: 'Wellington' },
  { types: ['postal_code'], longText: '6011' },
  { types: ['country'], longText: 'New Zealand', shortText: 'NZ' },
]

describe('mapPlaceToCustomAddress', () => {
  it('maps Google address components to CustomAddress', () => {
    expect(mapPlaceToCustomAddress(wellington, 'Site office')).toEqual({
      name: 'Site office',
      address: '12 Cuba Street',
      city: 'Wellington',
      postal_code: '6011',
      country: 'NZ',
    })
  })

  it('returns null when street or locality is missing — a suburb-level pick is not shippable', () => {
    expect(
      mapPlaceToCustomAddress(wellington.filter((c) => !c.types.includes('route')), 'X'),
    ).toBeNull()
    expect(
      mapPlaceToCustomAddress(wellington.filter((c) => !c.types.includes('locality')), 'X'),
    ).toBeNull()
  })

  it('uses the ISO short code for country, never the display name', () => {
    const r = mapPlaceToCustomAddress(wellington, 'X')
    expect(r?.country).toBe('NZ')
  })
})
