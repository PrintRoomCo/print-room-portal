// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { BillingCountryConfig } from '@/lib/account/org-countries'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false }),
}))

import { CompanyProvider, useCompany } from './CompanyContext'

afterEach(cleanup)

const nz: BillingCountryConfig = {
  code: 'NZ',
  name: 'New Zealand',
  currency: 'NZD',
  taxRate: 0.15,
  taxLabel: 'GST 15%',
  isDefault: true,
}

function Probe() {
  const { defaultBillingCountry } = useCompany()
  return (
    <p data-testid="billing-country">
      {defaultBillingCountry.code}:{defaultBillingCountry.currency}:{defaultBillingCountry.taxRate}
    </p>
  )
}

describe('CompanyProvider', () => {
  it('exposes the complete default billing-country config', () => {
    render(
      <CompanyProvider defaultBillingCountry={nz}>
        <Probe />
      </CompanyProvider>,
    )

    expect(screen.getByTestId('billing-country').textContent).toBe('NZ:NZD:0.15')
  })
})
