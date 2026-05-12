'use client'

import { Sidebar } from './Sidebar'
import { useCompany } from '@/contexts/CompanyContext'
import { CartChip } from '@/components/cart/CartChip'
import { PortalSkeleton } from '@/components/ui/PortalSkeleton'
import { RoleChangeNotice } from './RoleChangeNotice'

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
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" suppressHydrationWarning>
          Unable to load account data. Please sign in again or contact your account manager.
        </div>
      </div>
    )
  }

  return (
    <Sidebar customer={access}>
      {children}
      <CartChip />
      <RoleChangeNotice />
    </Sidebar>
  )
}
