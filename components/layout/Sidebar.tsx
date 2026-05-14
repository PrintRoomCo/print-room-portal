'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { usePortalDrawer } from './PortalTopBarContext'
import type { B2BCustomerAccess } from '@/types/company'

interface SidebarProps {
  children: React.ReactNode
  customer: B2BCustomerAccess
}

type TenantType = NonNullable<B2BCustomerAccess['tenantType']>

// Navigation items with permission requirements.
// "My Account" lives in the AccountMenu dropdown in the top bar — not here.
// "Sign Out" lives in the AccountMenu too. Catalogue absorbs the previous
// Shop + Inventory surfaces (inline stock chip on each card).
const allNavItems = [
  {
    name: 'Tracking',
    href: '/tracking',
    icon: TrackerIcon,
    requiresCompany: false,
    requiresLeavers: false,
    requiredTenantTypes: null as ReadonlyArray<TenantType> | null,
  },
  {
    name: 'Catalogue',
    href: '/catalogue',
    icon: CatalogueIcon,
    requiresCompany: true,
    requiresLeavers: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Orders',
    href: '/my-collections',
    icon: OrdersIcon,
    requiresCompany: false,
    requiresLeavers: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Proofs',
    href: '/proofs',
    icon: ProofsIcon,
    requiresCompany: true,
    requiresLeavers: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Leavers Quotes',
    href: '/leavers-quotes',
    icon: LeaversIcon,
    requiresCompany: false,
    requiresLeavers: true,
    requiredTenantTypes: null,
  },
] as const

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
  const pathname = usePathname() ?? ''
  const drawer = usePortalDrawer()
  const navigation = getNavigationItems(customer)

  // Close drawer on route change
  useEffect(() => {
    drawer.setOpen(false)
    // Intentionally only fire on path change; drawer.setOpen identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Close drawer on Escape key
  useEffect(() => {
    if (!drawer.open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') drawer.setOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer.open])

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawer.open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawer.open])

  return (
    <>
      {/* Backdrop scrim — fades in/out */}
      <div
        onClick={() => drawer.setOpen(false)}
        aria-hidden={!drawer.open}
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          drawer.open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer — floating glass pill, slides in from the left */}
      <aside
        aria-label="Portal navigation"
        aria-hidden={!drawer.open}
        className={`fixed left-3 top-3 bottom-3 z-50 flex w-72 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 shadow-lg backdrop-blur-md transition-transform duration-300 ease-out motion-reduce:transition-none ${
          drawer.open ? 'translate-x-0' : '-translate-x-[calc(100%+12px)]'
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <Link
            href="/account"
            onClick={() => drawer.setOpen(false)}
            aria-label="The Print Room"
            className="flex items-center"
          >
            <Image
              src="/print-room-logo.png"
              alt=""
              width={28}
              height={28}
              priority
              className="h-7 w-7 object-contain"
            />
          </Link>
          <button
            type="button"
            onClick={() => drawer.setOpen(false)}
            aria-label="Close navigation menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-all duration-150 hover:bg-gray-50 hover:text-gray-900"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-1">
            {navigation.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className={`group flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-pr-blue/10 text-pr-blue'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    tabIndex={drawer.open ? 0 : -1}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span>{item.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {customer.companyName && (
          <div className="border-t border-gray-200/70 px-5 py-4">
            <p className="text-xs text-gray-500">Signed in as</p>
            <p className="mt-1 truncate text-sm font-medium text-gray-900">
              {customer.firstName} {customer.lastName}
            </p>
            <p className="truncate text-xs text-gray-500">{customer.companyName}</p>
          </div>
        )}
      </aside>

      {/* Main content — offset by the floating top bar height */}
      <main className="w-full pt-[var(--portal-topbar-h,76px)]">
        {children}
      </main>
    </>
  )
}

// ─── Icons ─────────────────────────────────────────────────────────

function OrdersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  )
}

function CatalogueIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M3 5a2 2 0 012-2h4a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM13 5a2 2 0 012-2h4a2 2 0 012 2v14a2 2 0 01-2 2h-4a2 2 0 01-2-2V5z"
      />
    </svg>
  )
}

function TrackerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
      />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}

function LeaversIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"
      />
    </svg>
  )
}

function ProofsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M8 7h8M8 11h8M8 15h5M6 3h9l3 3v15H6V3z"
      />
    </svg>
  )
}
