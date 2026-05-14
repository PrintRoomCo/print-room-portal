'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import type { B2BCustomerAccess } from '@/types/company'
import { usePortalDrawer } from './PortalTopBarContext'

interface SidebarProps {
  children: React.ReactNode
  customer: B2BCustomerAccess
}

type TenantType = NonNullable<B2BCustomerAccess['tenantType']>

// Navigation items with permission requirements.
// Cart is intentionally NOT a sidebar entry — it lives in the global PortalTopBar as the "Bag" pill (see TopBarCartPill).
// Catalogue absorbs the previous Shop + Inventory surfaces — stock shows
// inline on each product card, no separate page (2026-05-14).
// My Account lives in the top bar's right-slot dropdown (Settings + Sign Out)
// — accessible from every page without opening the drawer.
const allNavItems = [
  { name: 'Tracking', href: '/tracking', icon: TrackerIcon, requiresCompany: false, requiresLeavers: false, requiredTenantTypes: null as ReadonlyArray<TenantType> | null },
  { name: 'Catalogue', href: '/catalogue', icon: OrdersIcon, requiresCompany: true, requiresLeavers: false, requiredTenantTypes: null },
  { name: 'Orders', href: '/my-collections', icon: OrdersIcon, requiresCompany: false, requiresLeavers: false, requiredTenantTypes: null },
  { name: 'Proofs', href: '/proofs', icon: ProofsIcon, requiresCompany: true, requiresLeavers: false, requiredTenantTypes: null },
  { name: 'Leavers Quotes', href: '/leavers-quotes', icon: LeaversIcon, requiresCompany: false, requiresLeavers: true, requiredTenantTypes: null },
] as const

// Build navigation based on user permissions
function getNavigationItems(customer: B2BCustomerAccess) {
  return allNavItems.filter((item) => {
    if (item.requiresCompany && !customer.isCompanyUser) return false
    if (item.requiresLeavers && !customer.canUseLeavers) return false
    if (item.requiredTenantTypes) {
      if (!customer.tenantType) return false
      if (!item.requiredTenantTypes.includes(customer.tenantType)) return false
    }
    return true
  })
}

export function Sidebar({ children, customer }: SidebarProps) {
  const pathname = usePathname()
  const { open, setOpen, toggle } = usePortalDrawer()

  // Close drawer on route change
  useEffect(() => {
    setOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Close drawer on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, setOpen])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const navigation = getNavigationItems(customer)

  return (
    <div className="min-h-screen bg-white">
      {/* Mobile-only floating header — provides the menu button on small screens
          where the desktop PortalTopBar is hidden. */}
      <nav aria-label="Mobile header" className="md:hidden">
        <div className="header-floating-wrapper">
          <div className="header-floating-inner">
            <Link href="/account" className="flex items-center gap-2">
              <Image
                src="/print-room-logo.png"
                alt="Print Room Logo"
                width={32}
                height={32}
                priority
                style={{ width: 'auto', height: 'auto' }}
                className="object-contain"
              />
              <span className="text-pr-blue text-base font-normal lowercase">portal</span>
            </Link>
            <button
              type="button"
              onClick={toggle}
              aria-label="Open navigation menu"
              className="p-2 rounded-full hover:bg-white/50 transition-colors duration-300 ease-spring"
            >
              <HamburgerIcon className="w-6 h-6 text-foreground" />
            </button>
          </div>
        </div>
      </nav>

      {/* Drawer Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer — slides in from the left on every viewport */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-64 glass-sidebar flex flex-col z-50 transition-transform duration-300 ease-spring ${
          open ? 'translate-x-0' : '-translate-x-full'
        } overflow-hidden`}
      >
        {/* Close button */}
        <div className="flex items-center justify-end p-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="p-2 rounded-full hover:bg-white/60 transition-colors duration-300 ease-spring"
          >
            <CloseIcon className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Logo */}
        <div className="p-6 border-b border-lime-200/60">
          <Link href="/account" className="flex items-center gap-3 group">
            <div className="w-16 h-16 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-center overflow-hidden transition-all duration-300 ease-spring group-hover:shadow-md flex-shrink-0">
              <Image
                src="/print-room-logo.png"
                alt="Print Room Logo"
                width={56}
                height={56}
                priority
                style={{ width: 'auto', height: 'auto' }}
                className="object-contain"
              />
            </div>
            <div className="h-10 w-px bg-pr-blue/30" />
            <span className="text-pr-blue text-xl font-normal lowercase whitespace-nowrap">
              portal
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className="whitespace-nowrap">{item.name}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main Content — full-width on desktop now that sidebar is drawer-only.
          Top padding clears the floating top bar (mobile) or the desktop
          floating bar (CSS var --portal-topbar-h, set by PortalTopBar). */}
      <main className="w-full">
        <div className="p-4 pt-20 md:p-8 md:pt-[var(--portal-topbar-h,76px)]">
          {children}
        </div>
      </main>
    </div>
  )
}

// ─── Icon Components (ported verbatim from Layout.tsx) ──────────────

function OrdersIcon({ className }: { className?: string }) {
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

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function LeaversIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" />
    </svg>
  )
}

function ProofsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8M8 11h8M8 15h5M6 3h9l3 3v15H6V3z" />
    </svg>
  )
}
