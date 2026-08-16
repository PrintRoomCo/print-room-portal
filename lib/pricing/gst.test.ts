import { describe, it, expect } from 'vitest'
import { normalizeOrgRegion, gstRateForRegion, currencyForRegion } from './gst'

describe('normalizeOrgRegion', () => {
  it('is AU only for the exact string AU; everything else is NZ', () => {
    expect(normalizeOrgRegion('AU')).toBe('AU')
    for (const v of ['NZ', 'au', 'AUS', 'Australia', '', null, undefined, 0]) {
      expect(normalizeOrgRegion(v)).toBe('NZ')
    }
  })
})

describe('gstRateForRegion', () => {
  it('AU → 0.10, everything else → 0.15', () => {
    expect(gstRateForRegion('AU')).toBe(0.1)
    expect(gstRateForRegion('NZ')).toBe(0.15)
    expect(gstRateForRegion(null)).toBe(0.15)
    expect(gstRateForRegion(undefined)).toBe(0.15)
  })
})

describe('currencyForRegion', () => {
  it('AU → AUD, everything else → NZD', () => {
    expect(currencyForRegion('AU')).toBe('AUD')
    expect(currencyForRegion('NZ')).toBe('NZD')
    expect(currencyForRegion(null)).toBe('NZD')
  })
})
