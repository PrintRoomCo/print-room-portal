import type { Metadata } from 'next'
import { AccountClient } from './AccountClient'
import { getServerExchangeRate } from '@/lib/currency/server-exchange-rates'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { getPortalAccountData } from '@/lib/portal-data'
import { getEnabledCountriesForCurrentOrg } from '@/lib/account/org-countries'

export const metadata: Metadata = {
  title: 'Account',
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const [sp, result, accountData, enabledCountries] = await Promise.all([
    searchParams,
    getServerExchangeRate('AUD'),
    getPortalAccountData(),
    getEnabledCountriesForCurrentOrg(),
  ])

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-[1320px] px-6 pt-[120px] pb-16">
        {sp.reason === 'no_org' && (
          <div className="mb-8">
            <PortalEmptyState
              title="Your account isn't fully set up yet"
              body="Your organisation hasn't been provisioned in our system. Your account manager will reach out shortly — or contact us if you'd like to chase it up."
              actionHref="mailto:hello@theprint-room.co.nz"
              actionLabel="Contact sales"
            />
          </div>
        )}
        <AccountClient
          ratesFetchedAt={result.fetchedAt}
          initialData={accountData}
          enabledCountries={enabledCountries}
        />
      </div>
    </div>
  )
}
