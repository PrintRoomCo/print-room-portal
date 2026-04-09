import { CompanyProvider } from '@/contexts/CompanyContext'
import { PortalShell } from '@/components/layout/PortalShell'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProvider>
      <PortalShell>{children}</PortalShell>
    </CompanyProvider>
  )
}
