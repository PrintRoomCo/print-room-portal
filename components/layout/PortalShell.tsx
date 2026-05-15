'use client'

import { Sidebar } from './Sidebar'
import { useCompany } from '@/contexts/CompanyContext'
import { PortalSkeleton } from '@/components/ui/PortalSkeleton'
import { RoleChangeNotice } from './RoleChangeNotice'
import { PortalTopBar } from './PortalTopBar'
import { PortalTopBarProvider } from './PortalTopBarContext'

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { access, loading } = useCompany()

  if (loading) {
    return (
      <div className="min-h-screen bg-white p-6 md:p-10" suppressHydrationWarning>
        <PortalSkeleton rows={3} />
      </div>
    )
  }

  if (!access) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-white"
        suppressHydrationWarning
      >
        <div className="rounded-3xl border border-gray-200 bg-white p-5 text-sm text-gray-700" suppressHydrationWarning>
          Unable to load account data. Please sign in again or contact your account manager.
        </div>
      </div>
    )
  }

  return (
    <PortalTopBarProvider>
      <PortalTopBar />
      <Sidebar customer={access}>
        {children}
        <RoleChangeNotice />
      </Sidebar>
    </PortalTopBarProvider>
  )
}
