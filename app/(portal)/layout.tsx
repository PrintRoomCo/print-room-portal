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
import {
  getOrgDefaultBillingCountry,
  getPlatformBillingCountry,
} from '@/lib/account/org-countries'
import { getSupabaseServer } from '@/lib/supabase'
import { readMinOrderExempt, readOrgIsTest } from '@/lib/checkout/server'

async function CountryAwareCompanyProvider({
  children,
  initialAccess,
  initialUserId,
  countryPartitionEnabled,
  initialRates,
}: {
  children: React.ReactNode
  initialAccess: Awaited<ReturnType<typeof getPortalCompanyAccess>>
  initialUserId: string | null
  countryPartitionEnabled: boolean
  initialRates: Awaited<ReturnType<typeof getServerExchangeRates>>['rates']
}) {
  const defaultBillingCountry = initialAccess?.companyId
    ? await getOrgDefaultBillingCountry(getSupabaseServer(), initialAccess.companyId)
    : await getPlatformBillingCountry(getSupabaseServer(), 'NZ')

  // Same tolerant read as the checkout context: min_order_exempt ships from the
  // staff repo on its own schedule, so a missing column must not blank the org.
  const minimumOrderExemptions = initialAccess?.companyId
    ? {
        orgExempt: await readMinOrderExempt(getSupabaseServer(), initialAccess.companyId),
        isTest: await readOrgIsTest(getSupabaseServer(), initialAccess.companyId),
      }
    : { orgExempt: false, isTest: false }

  // Saved cookie -> geo country -> org base currency. Resolved here rather
  // than in PortalLayout because the terminal fallback is the org's base
  // currency, which is only known once defaultBillingCountry loads.
  const initialCurrency = await resolveInitialCurrency(defaultBillingCountry.currency)

  return (
    <CompanyProvider
      initialAccess={initialAccess}
      initialUserId={initialUserId}
      countryPartitionEnabled={countryPartitionEnabled}
      defaultBillingCountry={defaultBillingCountry}
      minimumOrderExemptions={minimumOrderExemptions}
    >
      <CurrencyProvider
        initialRates={initialRates}
        initialCurrency={initialCurrency}
        baseCurrency={defaultBillingCountry.currency}
      >
        {children}
      </CurrencyProvider>
    </CompanyProvider>
  )
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [user, access, exchangeRates] = await Promise.all([
    getPortalUser(),
    getPortalCompanyAccess(),
    getServerExchangeRates(),
  ])
  const countryPartitionEnabled = isCheckoutCountryPartitionEnabled()

  return (
    <AuthProvider initialUser={user}>
      <Suspense fallback={null}>
        <CountryAwareCompanyProvider
          initialAccess={access}
          initialUserId={user?.id ?? null}
          countryPartitionEnabled={countryPartitionEnabled}
          initialRates={exchangeRates.rates}
        >
          <PreviewBanner />
          <CartProvider>
            <PortalShell>{children}</PortalShell>
          </CartProvider>
        </CountryAwareCompanyProvider>
      </Suspense>
    </AuthProvider>
  )
}
