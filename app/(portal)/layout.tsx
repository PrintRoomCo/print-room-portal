import { Suspense } from 'react'
import { AuthProvider } from '@/contexts/AuthContext'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { CartProvider } from '@/components/cart/CartProvider'
import { PortalShell } from '@/components/layout/PortalShell'
import { PreviewBanner } from '@/components/preview/PreviewBanner'
import { getPortalCompanyAccess, getPortalUser } from '@/lib/portal-data'
import { getServerExchangeRates } from '@/lib/currency/server-exchange-rates'
import { resolveInitialCurrency } from '@/lib/currency/server-currency'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import { getOrgDefaultBillingCountry } from '@/lib/account/org-countries'
import { getSupabaseServer } from '@/lib/supabase'

async function CountryAwareCompanyProvider({
  children,
  initialAccess,
  initialUserId,
  countryPartitionEnabled,
}: {
  children: React.ReactNode
  initialAccess: Awaited<ReturnType<typeof getPortalCompanyAccess>>
  initialUserId: string | null
  countryPartitionEnabled: boolean
}) {
  const defaultBillingCountry =
    countryPartitionEnabled && initialAccess?.companyId
      ? await getOrgDefaultBillingCountry(getSupabaseServer(), initialAccess.companyId)
      : null

  return (
    <CompanyProvider
      initialAccess={initialAccess}
      initialUserId={initialUserId}
      countryPartitionEnabled={countryPartitionEnabled}
      defaultBillingCountryCode={defaultBillingCountry?.code ?? null}
    >
      {children}
    </CompanyProvider>
  )
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [user, access, exchangeRates, initialCurrency] = await Promise.all([
    getPortalUser(),
    getPortalCompanyAccess(),
    getServerExchangeRates(),
    resolveInitialCurrency(),
  ])
  const countryPartitionEnabled = isCheckoutCountryPartitionEnabled()

  return (
    <AuthProvider initialUser={user}>
      <Suspense fallback={null}>
        <CountryAwareCompanyProvider
          initialAccess={access}
          initialUserId={user?.id ?? null}
          countryPartitionEnabled={countryPartitionEnabled}
        >
          <PreviewBanner />
          <CurrencyProvider
            initialRates={exchangeRates.rates}
            initialCurrency={access?.region === 'AU' ? 'AUD' : initialCurrency}
            billingCurrency={access?.region === 'AU' ? 'AUD' : null}
          >
            <CartProvider>
              <PortalShell>{children}</PortalShell>
            </CartProvider>
          </CurrencyProvider>
        </CountryAwareCompanyProvider>
      </Suspense>
    </AuthProvider>
  )
}
