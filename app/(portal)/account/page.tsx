import { AccountClient } from './AccountClient'
import { CurrencyDisplayPreferenceSection } from '@/components/account/CurrencyDisplayPreferenceSection'
import { getServerExchangeRate } from '@/lib/currency/server-exchange-rates'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'

export const dynamic = 'force-dynamic'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const [sp, result] = await Promise.all([searchParams, getServerExchangeRate('AUD')])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {sp.reason === 'no_org' && (
        <PortalEmptyState
          title="Your account isn't fully set up yet"
          body="Your organisation hasn't been provisioned in our system. Your account manager will reach out shortly — or contact us if you'd like to chase it up."
          actionHref="mailto:sales@theprint-room.co.nz"
          actionLabel="Contact sales"
        />
      )}
      <CurrencyDisplayPreferenceSection fetchedAt={result.fetchedAt} />
      <AccountClient />
    </div>
  )
}
