import { CompanyProvider } from '@/contexts/CompanyContext'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { CartProvider } from '@/components/cart/CartProvider'
import { PortalShell } from '@/components/layout/PortalShell'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProvider>
      <CurrencyProvider>
        <CartProvider>
          <PortalShell>{children}</PortalShell>
        </CartProvider>
      </CurrencyProvider>
    </CompanyProvider>
  )
}
