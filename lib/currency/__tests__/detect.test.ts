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
