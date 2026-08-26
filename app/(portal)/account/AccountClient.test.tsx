import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountClient } from './AccountClient'

const state = vi.hoisted(() => ({
  currency: 'NZD',
}))

vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({
    access: {
      userId: 'user-1',
      email: 'buyer@example.com',
      firstName: 'Aroha',
      lastName: 'Buyer',
      companyId: 'org-1',
      companyName: 'Example Org',
      logoUrl: null,
      locationIds: [],
      role: 'staff',
      isCompanyUser: true,
      isOrgAdmin: false,
    },
    defaultBillingCountry: {
      code: state.currency === 'AUD' ? 'AU' : 'NZ',
      name: state.currency === 'AUD' ? 'Australia' : 'New Zealand',
      currency: state.currency,
      taxRate: state.currency === 'AUD' ? 0.1 : 0.15,
      taxLabel: state.currency === 'AUD' ? 'GST 10%' : 'GST 15%',
      isDefault: true,
    },
    loading: false,
  }),
}))

vi.mock('@/components/account/CurrencyDisplayPreferenceSection', () => ({
  CurrencyDisplayPreferenceSection: () => <div>Currency preference</div>,
}))

describe('AccountClient billing currency preference', () => {
  beforeEach(() => {
    state.currency = 'NZD'
  })

  it('shows display-currency preferences for an NZD billing country', () => {
    render(
      <AccountClient
        ratesFetchedAt={null}
        initialData={{ stores: [], recentQuotes: [], ownerKey: 'org:org-1' }}
        enabledCountries={[]}
      />,
    )

    expect(screen.getByText('Currency preference')).toBeInTheDocument()
  })

  it('hides display-currency preferences for a non-NZD billing country', () => {
    state.currency = 'AUD'

    render(
      <AccountClient
        ratesFetchedAt={null}
        initialData={{ stores: [], recentQuotes: [], ownerKey: 'org:org-1' }}
        enabledCountries={[]}
      />,
    )

    expect(screen.queryByText('Currency preference')).not.toBeInTheDocument()
  })
})
