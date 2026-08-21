import { describe, expect, it } from 'vitest'
import { sortEnabledCountries } from '@/lib/account/org-countries'

describe('sortEnabledCountries', () => {
  it('puts the default first, then alphabetical', () => {
    expect(
      sortEnabledCountries([
        { code: 'AU', name: 'Australia', isDefault: false },
        { code: 'NZ', name: 'New Zealand', isDefault: true },
        { code: 'GB', name: 'United Kingdom', isDefault: false },
      ]).map((c) => c.code),
    ).toEqual(['NZ', 'AU', 'GB'])
  })
  it('handles an empty list', () => {
    expect(sortEnabledCountries([])).toEqual([])
  })
})
