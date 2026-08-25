import { describe, expect, it, vi } from 'vitest'

import {
  getOrgDefaultBillingCountry,
  getOrgEnabledCountries,
  sortEnabledCountries,
} from './org-countries'

function countryAdmin(rows: unknown[]) {
  const filters: Array<[string, unknown]> = []
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      return query
    }),
    then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data: rows }),
  }
  return {
    admin: { from: vi.fn(() => query) } as never,
    query,
    filters,
  }
}

describe('getOrgEnabledCountries', () => {
  it('orders the default first and every remaining country by ISO code', () => {
    expect(sortEnabledCountries([
      { code: 'US', name: 'America', isDefault: false },
      { code: 'NZ', name: 'New Zealand', isDefault: true },
      { code: 'DE', name: 'Germany', isDefault: false },
    ]).map((country) => country.code)).toEqual(['NZ', 'DE', 'US'])
  })

  it('returns the one default first with its authored billing metadata and filters inactive countries', async () => {
    const { admin, query, filters } = countryAdmin([
      {
        country_code: 'NZ',
        is_default: false,
        countries: {
          name: 'New Zealand',
          currency: 'NZD',
          tax_rate: '0.15',
          tax_label: 'GST 15%',
        },
      },
      {
        country_code: 'AU',
        is_default: true,
        countries: {
          name: 'Australia',
          currency: 'AUD',
          tax_rate: '0.10',
          tax_label: 'GST 10%',
        },
      },
    ])

    await expect(getOrgEnabledCountries(admin, 'org-1')).resolves.toStrictEqual([
      {
        code: 'AU',
        name: 'Australia',
        currency: 'AUD',
        taxRate: 0.1,
        taxLabel: 'GST 10%',
        isDefault: true,
      },
      {
        code: 'NZ',
        name: 'New Zealand',
        currency: 'NZD',
        taxRate: 0.15,
        taxLabel: 'GST 15%',
        isDefault: false,
      },
    ])
    expect(query.select).toHaveBeenCalledWith(
      'country_code, is_default, countries!inner(name, currency, tax_rate, tax_label)',
    )
    expect(filters).toContainEqual(['organization_id', 'org-1'])
    expect(filters).toContainEqual(['countries.is_active', true])
  })

  it('throws explicitly when the organization has no active default country', async () => {
    const { admin } = countryAdmin([
      {
        country_code: 'AU',
        is_default: false,
        countries: {
          name: 'Australia',
          currency: 'AUD',
          tax_rate: 0.1,
          tax_label: 'GST 10%',
        },
      },
    ])

    await expect(getOrgDefaultBillingCountry(admin, 'org-without-default')).rejects.toThrow(
      'Organization org-without-default has no enabled default billing country',
    )
  })
})
