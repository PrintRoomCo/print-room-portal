import { AccountClient } from './AccountClient'
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
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-6 pb-16 pt-[120px]">
        {sp.reason === 'no_org' && (
          <div className="mb-12">
            <PortalEmptyState
              title="Your account isn't fully set up yet"
              body="Your organisation hasn't been provisioned in our system. Your account manager will reach out shortly — or contact us if you'd like to chase it up."
              actionHref="mailto:hello@theprint-room.co.nz"
              actionLabel="Contact sales"
            />
          </div>
        )}
        <AccountClient ratesFetchedAt={result.fetchedAt} />
      </div>
    </div>
  )
}
