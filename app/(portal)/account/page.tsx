import { AccountClient } from './AccountClient'
import { CurrencyDisplayPreferenceSection } from '@/components/account/CurrencyDisplayPreferenceSection'
import { getServerExchangeRate } from '@/lib/currency/server-exchange-rates'

export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const result = await getServerExchangeRate('AUD')

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <CurrencyDisplayPreferenceSection fetchedAt={result.fetchedAt} />
      <AccountClient />
    </div>
  )
}
