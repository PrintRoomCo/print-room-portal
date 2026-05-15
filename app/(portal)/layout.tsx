import { AuthProvider } from '@/contexts/AuthContext'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { CartProvider } from '@/components/cart/CartProvider'
import { PortalShell } from '@/components/layout/PortalShell'
import { getPortalCompanyAccess, getPortalUser } from '@/lib/portal-data'
import { getServerExchangeRates } from '@/lib/currency/server-exchange-rates'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [user, access, exchangeRates] = await Promise.all([
    getPortalUser(),
    getPortalCompanyAccess(),
    getServerExchangeRates(),
  ])

  return (
    <AuthProvider initialUser={user}>
      <CompanyProvider initialAccess={access} initialUserId={user?.id ?? null}>
        <CurrencyProvider initialRates={exchangeRates.rates}>
          <CartProvider>
            <PortalShell>{children}</PortalShell>
          </CartProvider>
        </CurrencyProvider>
      </CompanyProvider>
    </AuthProvider>
  )
}
