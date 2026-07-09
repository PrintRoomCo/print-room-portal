'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { RoleChangeNotice } from './RoleChangeNotice'
import { PortalTopBar } from './PortalTopBar'
import { PortalTopBarProvider } from './PortalTopBarContext'
import { CartDrawer } from '@/components/cart/CartDrawer'
import { CartAddedToasts } from '@/components/cart/CartAddedToasts'

export function PortalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { access, loading: companyLoading } = useCompany()
  const signedOutWithoutAccess = !authLoading && !user && !access

  useEffect(() => {
    if (signedOutWithoutAccess) {
      router.replace('/sign-in')
    }
  }, [router, signedOutWithoutAccess])

  if ((authLoading || companyLoading || signedOutWithoutAccess) && !access) {
    return null
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:rounded-full focus:bg-pr-charcoal focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <PortalTopBar />
      <CartDrawer />
      <CartAddedToasts />
      <Sidebar customer={access}>
        {children}
        <RoleChangeNotice />
      </Sidebar>
    </PortalTopBarProvider>
  )
}
