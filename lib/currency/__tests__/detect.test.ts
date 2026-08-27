import { describe, it, expect } from 'vitest'
import { currencyForCountry, resolveCurrency } from '../detect'

describe('currencyForCountry', () => {
  it('maps New Zealand to NZD', () => {
    expect(currencyForCountry('NZ')).toBe('NZD')
  })

  it('maps Australia to AUD', () => {
    expect(currencyForCountry('AU')).toBe('AUD')
  })

  it('maps the United States to USD', () => {
    expect(currencyForCountry('US')).toBe('USD')
  })

  it('maps the United Kingdom to GBP', () => {
    expect(currencyForCountry('GB')).toBe('GBP')
  })

  it('maps eurozone countries to EUR', () => {
    expect(currencyForCountry('DE')).toBe('EUR')
    expect(currencyForCountry('FR')).toBe('EUR')
    expect(currencyForCountry('IE')).toBe('EUR')
  })

  it('is case-insensitive on the country code', () => {
    expect(currencyForCountry('nz')).toBe('NZD')
  })

  it('falls back to NZD for unknown countries', () => {
    expect(currencyForCountry('JP')).toBe('NZD')
  })

  it('falls back to NZD when the country is missing (local dev / bots / unknown)', () => {
    expect(currencyForCountry(null)).toBe('NZD')
    expect(currencyForCountry(undefined)).toBe('NZD')
    expect(currencyForCountry('')).toBe('NZD')
  })
})

describe('resolveCurrency', () => {
  it('prefers a valid saved preference over the geo-detected country', () => {
    expect(resolveCurrency({ saved: 'USD', country: 'NZ' })).toBe('USD')
  })

  it('uses the geo-detected country when there is no saved preference', () => {
    expect(resolveCurrency({ saved: null, country: 'AU' })).toBe('AUD')
  })

  it('ignores an invalid saved preference and falls back to geo', () => {
    expect(resolveCurrency({ saved: 'XXX', country: 'GB' })).toBe('GBP')
  })

  it('falls back to NZD when nothing is known', () => {
    expect(resolveCurrency({ saved: null, country: null })).toBe('NZD')
  })
})

describe('currencyForCountry with an explicit fallback', () => {
  it('uses the fallback for unknown countries', () => {
    expect(currencyForCountry('JP', 'AUD')).toBe('AUD')
  })

  it('uses the fallback when the country is missing', () => {
    expect(currencyForCountry(null, 'AUD')).toBe('AUD')
    expect(currencyForCountry(undefined, 'AUD')).toBe('AUD')
  })

  it('still resolves a known country over the fallback', () => {
    expect(currencyForCountry('US', 'AUD')).toBe('USD')
  })
})

describe('resolveCurrency fallback chain (saved, then geo, then base)', () => {
  it('prefers a valid saved preference over geo and the fallback', () => {
    expect(resolveCurrency({ saved: 'USD', country: 'NZ', fallback: 'AUD' })).toBe('USD')
  })

  it('prefers the geo country over the fallback', () => {
    expect(resolveCurrency({ saved: null, country: 'US', fallback: 'AUD' })).toBe('USD')
  })

  it('lands on the fallback only when saved and geo are both absent', () => {
    expect(resolveCurrency({ saved: null, country: null, fallback: 'AUD' })).toBe('AUD')
  })

  it('keeps NZD as the default fallback so the NZ-org chain is unchanged', () => {
    expect(resolveCurrency({ saved: null, country: null })).toBe('NZD')
  })
})
