import { CompanyProvider } from '@/contexts/CompanyContext'
import { CartProvider } from '@/components/cart/CartProvider'
import { PortalShell } from '@/components/layout/PortalShell'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProvider>
      <CartProvider>
        <PortalShell>{children}</PortalShell>
      </CartProvider>
    </CompanyProvider>
  )
}
