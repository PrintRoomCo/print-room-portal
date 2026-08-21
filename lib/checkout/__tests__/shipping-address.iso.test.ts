import { describe, expect, it } from 'vitest'
import { isoCountryOrNull } from '@/lib/checkout/shipping-address'

describe('isoCountryOrNull', () => {
  it('passes exact ISO codes through, uppercased', () => {
    expect(isoCountryOrNull('nz')).toBe('NZ')
    expect(isoCountryOrNull('AU')).toBe('AU')
    expect(isoCountryOrNull('GB')).toBe('GB')
  })
  it('maps the known NZ/AU free-text variants (legacy drafts)', () => {
    expect(isoCountryOrNull('New Zealand')).toBe('NZ')
    expect(isoCountryOrNull(' NZL ')).toBe('NZ')
    expect(isoCountryOrNull('australia')).toBe('AU')
  })
  it('returns null for empty or unrecognisable input', () => {
    expect(isoCountryOrNull('')).toBeNull()
    expect(isoCountryOrNull(null)).toBeNull()
    expect(isoCountryOrNull('Aotearoa')).toBeNull()
  })
})
