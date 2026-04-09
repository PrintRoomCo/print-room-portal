'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import type { B2BCustomerAccess } from '@/types/company'

interface SidebarProps {
  children: React.ReactNode
  customer: B2BCustomerAccess
}

// Navigation items with permission requirements
const allNavItems = [
  { name: 'My Account', href: '/account', icon: HomeIcon, requiresCompany: false },
  { name: 'Projects', href: '/order-tracker', icon: TrackerIcon, requiresCompany: false },
  { name: 'My Quotes', href: '/my-collections', icon: CatalogsIcon, requiresCompany: false },
] as const

// Build navigation based on user permissions
function getNavigationItems(customer: B2BCustomerAccess) {
  return allNavItems.filter((item) => {
    if (item.requiresCompany && !customer.isCompanyUser) {
      return false
    }
    return true
  })
}

export function Sidebar({ children, customer }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Hydrate sidebar collapsed state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed')
    if (stored === 'true') setSidebarCollapsed(true)
  }, [])

  // Persist sidebar collapsed state
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Close drawer on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    if (drawerOpen) {
      document.addEventListener('keydown', handleEscape)
    }
    return () => document.removeEventListener('keydown', handleEscape)
  }, [drawerOpen])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  const navigation = getNavigationItems(customer)

  return (
    <div className="flex min-h-screen bg-white">
      {/* Mobile Floating Header */}
      <nav aria-label="Mobile header" className="md:hidden">
        <div className="header-floating-wrapper">
          <div className="header-floating-inner">
            <Link href="/account" className="flex items-center gap-2">
              <Image
                src="/print-room-logo.png"
                alt="Print Room Logo"
                width={32}
                height={32}
                style={{ width: 'auto', height: 'auto' }}
                className="object-contain"
              />
              <span className="text-pr-blue text-base font-normal lowercase">portal</span>
            </Link>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="p-2 rounded-full hover:bg-white/50 transition-colors duration-300 ease-spring"
            >
              <HamburgerIcon className="w-6 h-6 text-foreground" />
            </button>
          </div>
        </div>
      </nav>

      {/* Drawer Backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar / Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 ${sidebarCollapsed ? 'w-[80px]' : 'w-64'} glass-sidebar flex flex-col z-50 transition-all duration-300 ease-spring ${drawerOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 overflow-hidden`}
      >
        {/* Top bar: mobile close + desktop collapse toggle */}
        <div className="flex items-center justify-end p-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
            className="p-2 rounded-full hover:bg-white/60 transition-colors duration-300 ease-spring md:hidden"
          >
            <CloseIcon className="w-5 h-5 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-2 rounded-full hover:bg-white/60 transition-colors duration-300 ease-spring hidden md:block"
          >
            {sidebarCollapsed ? (
              <ChevronRightIcon className="w-5 h-5 text-muted-foreground" />
            ) : (
              <ChevronLeftIcon className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
        </div>

        {/* Logo - hidden on mobile (shown in top bar instead) */}
        <div
          className={`${sidebarCollapsed ? 'px-2 py-4 flex justify-center' : 'p-6'} border-b border-lime-200/60 hidden md:block transition-all duration-300`}
        >
          <Link
            href="/account"
            className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} group`}
          >
            <div className="w-16 h-16 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-center overflow-hidden transition-all duration-300 ease-spring group-hover:shadow-md flex-shrink-0">
              <Image
                src="/print-room-logo.png"
                alt="Print Room Logo"
                width={56}
                height={56}
                style={{ width: 'auto', height: 'auto' }}
                className="object-contain"
              />
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="h-10 w-px bg-pr-blue/30" />
                <span className="text-pr-blue text-xl font-normal lowercase whitespace-nowrap">
                  portal
                </span>
              </>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav
          className={`flex-1 ${sidebarCollapsed ? 'px-2' : 'px-3'} py-4 space-y-1 overflow-y-auto transition-all duration-300`}
        >
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`sidebar-link ${isActive ? 'sidebar-link-active' : ''} ${sidebarCollapsed ? 'justify-center !px-2' : ''}`}
                title={sidebarCollapsed ? item.name : undefined}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <span className="whitespace-nowrap">{item.name}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div
          className={`${sidebarCollapsed ? 'p-2' : 'p-4'} border-t border-lime-200/60 transition-all duration-300`}
        >
          <button
            type="button"
            onClick={async () => { await signOut(); router.push('/sign-in') }}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3 px-4'} py-3 text-sm font-medium text-muted-foreground rounded-full hover:bg-white/50 transition-all duration-300 ease-spring font-dm-sans`}
            title={sidebarCollapsed ? 'Sign Out' : undefined}
          >
            <LogoutIcon className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && 'Sign Out'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 ml-0 ${sidebarCollapsed ? 'md:ml-[80px]' : 'md:ml-64'} transition-[margin] duration-300 ease-spring`}
      >
        <div className="p-4 pt-20 md:p-8 md:pt-8">{children}</div>
      </main>
    </div>
  )
}

// ─── Icon Components (ported verbatim from Layout.tsx) ──────────────

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function CatalogsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  )
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  )
}

function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function TrackerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  )
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
