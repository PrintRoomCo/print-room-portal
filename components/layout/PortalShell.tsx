'use client'

import { Sidebar } from './Sidebar'
import { useCompany } from '@/contexts/CompanyContext'

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { access, loading } = useCompany()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  if (!access) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-muted-foreground text-sm">Unable to load account data.</div>
      </div>
    )
  }

  return <Sidebar customer={access}>{children}</Sidebar>
}
