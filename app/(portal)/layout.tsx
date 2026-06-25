import { AuthProvider } from '@/contexts/AuthContext'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { CartProvider } from '@/components/cart/CartProvider'
import { PortalShell } from '@/components/layout/PortalShell'
import { PreviewBanner } from '@/components/preview/PreviewBanner'
import { getPortalCompanyAccess, getPortalUser } from '@/lib/portal-data'
import { getServerExchangeRates } from '@/lib/currency/server-exchange-rates'
import { resolveInitialCurrency } from '@/lib/currency/server-currency'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [user, access, exchangeRates, initialCurrency] = await Promise.all([
    getPortalUser(),
    getPortalCompanyAccess(),
    getServerExchangeRates(),
    resolveInitialCurrency(),
  ])

  return (
    <AuthProvider initialUser={user}>
      <CompanyProvider initialAccess={access} initialUserId={user?.id ?? null}>
        <PreviewBanner />
        <CurrencyProvider initialRates={exchangeRates.rates} initialCurrency={initialCurrency}>
          <CartProvider>
            <PortalShell>{children}</PortalShell>
          </CartProvider>
        </CurrencyProvider>
      </CompanyProvider>
    </AuthProvider>
  )
}
