import { describe, expect, it } from 'vitest'
import { resolveLocationCountry } from '@/lib/account/location-country'

const ENABLED = [
  { code: 'NZ', name: 'New Zealand', isDefault: true },
  { code: 'AU', name: 'Australia', isDefault: false },
]

describe('resolveLocationCountry', () => {
  it('accepts an enabled code, case-insensitively', () => {
    expect(resolveLocationCountry('au', ENABLED)).toBe('AU')
  })
  it('falls back to the default when the input is missing or not enabled', () => {
    expect(resolveLocationCountry('', ENABLED)).toBe('NZ')
    expect(resolveLocationCountry('US', ENABLED)).toBe('NZ')
    expect(resolveLocationCountry(null, ENABLED)).toBe('NZ')
  })
  it('returns null when the org has no enabled countries', () => {
    expect(resolveLocationCountry('NZ', [])).toBeNull()
  })
})
