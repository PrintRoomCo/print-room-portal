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

// Identifiers for the four hand-drawn rows rendered inside the inline SVG
// menu. Order = display order. Anything in `allNavItems` not listed here
// (e.g. Leavers Quotes) falls back to a classic Link row beneath the SVG.
type SvgRowId = 'tracking' | 'catalogue' | 'orders' | 'proofs'
const SVG_ROWS: ReadonlyArray<{ id: SvgRowId; label: string; href: string }> = [
  { id: 'tracking',  label: 'Tracking',  href: '/tracking' },
  { id: 'catalogue', label: 'Catalogue', href: '/catalogue' },
  { id: 'orders',    label: 'Orders',    href: '/my-collections' },
  { id: 'proofs',    label: 'Proofs',    href: '/proofs' },
]

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

  // SVG menu rows the current user is allowed to see. Permission gating
  // flows through `navigation` (already filtered by getNavigationItems).
  const visibleRows = SVG_ROWS
    .filter((row) => navigation.some((n) => n.href === row.href))
    .map((row) => ({
      ...row,
      isActive:
        pathname === row.href || pathname.startsWith(row.href + '/'),
    }))

  // Anything else still in `navigation` (e.g. Leavers Quotes) renders as
  // a classic Link below the SVG so we don't drop it silently.
  const extraItems = navigation.filter(
    (n) => !SVG_ROWS.some((r) => r.href === n.href),
  )

  // Row geometry (SVG units = viewBox).
  // - 80-tall rows give icons room to read and a 64-tall hit area, which
  //   sits well above WCAG 2.5.8 AA (24×24) and meets the larger 2.5.5 AAA
  //   target threshold on the long axis.
  // - Icons are drawn in a 24×24 local space and scaled 4/3 to 32×32.
  const ROW_H = 80
  const TOP_Y = 16
  const ICON_SCALE = 32 / 24
  const viewH = visibleRows.length * ROW_H + TOP_Y * 2

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
        aria-hidden={drawer.open ? 'false' : 'true'}
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          drawer.open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer — floating glass pill, slides in from the left.
          `inert` (React 19 boolean prop) takes the closed subtree out of the
          focus + accessibility tree atomically — replaces aria-hidden so a
          retained focus on the close button doesn't trip the WAI-ARIA rule. */}
      <aside
        aria-label="Portal navigation"
        inert={!drawer.open}
        data-vt-name="sidebar"
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
          {visibleRows.length > 0 && (
            <svg
              viewBox={`0 0 280 ${viewH}`}
              xmlns="http://www.w3.org/2000/svg"
              role="menu"
              aria-label="primary navigation"
              className="block w-full font-dm-sans text-base font-medium text-gray-700"
            >
              <defs />

              <g id="outline" pointerEvents="none">
                {visibleRows.map((row, i) => {
                  const rowY = TOP_Y + i * ROW_H
                  return (
                    <g
                      key={`o-${row.id}`}
                      data-row={row.id}
                      className={
                        row.isActive
                          ? 'text-[rgb(43_57_144)]'
                          : 'text-gray-700'
                      }
                    >
                      {row.isActive && (
                        <rect
                          x={0}
                          y={rowY + 24}
                          width={2}
                          height={32}
                          rx={1}
                          fill="currentColor"
                        />
                      )}
                      <g transform={`translate(8 ${rowY + 24}) scale(${ICON_SCALE})`}>
                        {row.id === 'tracking' && (
                          <>
                            {/* Screen printing carousel — top-down with
                                slight perspective oval on the hub. */}
                            <ellipse className="cls-line" cx={12} cy={12} rx={3} ry={2} />
                            <line className="cls-line" x1={12} y1={10} x2={12} y2={6} />
                            <line className="cls-line" x1={14} y1={12} x2={18} y2={12} />
                            <line className="cls-line" x1={12} y1={14} x2={12} y2={18} />
                            <line className="cls-line" x1={10} y1={12} x2={6} y2={12} />
                            <rect className="cls-line" x={8.5} y={2}   width={7} height={4} rx={1} />
                            <rect className="cls-line" x={18}  y={8.5} width={4} height={7} rx={1} />
                            <rect className="cls-line" x={8.5} y={18}  width={7} height={4} rx={1} />
                            <rect className="cls-line" x={2}   y={8.5} width={4} height={7} rx={1} />
                          </>
                        )}
                        {row.id === 'catalogue' && (
                          <>
                            {/* Tall paper bag with top fold — t.e. shop. */}
                            <rect
                              className="cls-line"
                              x={8}
                              y={2}
                              width={8}
                              height={20}
                              rx={0.5}
                            />
                            <line
                              className="cls-line"
                              x1={8}
                              y1={5.5}
                              x2={16}
                              y2={5.5}
                            />
                          </>
                        )}
                        {row.id === 'orders' && (
                          <>
                            {/* 12-petal flower/sun with inner hub — t.e. orders. */}
                            <path
                              className="cls-line"
                              d="M22,12 L19.2,13.9 L20.7,17 L17.3,17.3 L17,20.7 L13.9,19.2 L12,22 L10.1,19.2 L7,20.7 L6.7,17.3 L3.3,17 L4.8,13.9 L2,12 L4.8,10.1 L3.3,7 L6.7,6.7 L7,3.3 L10.1,4.8 L12,2 L13.9,4.8 L17,3.3 L17.3,6.7 L20.7,7 L19.2,10.1 Z"
                            />
                            <circle
                              className="cls-line"
                              cx={12}
                              cy={12}
                              r={3}
                            />
                          </>
                        )}
                        {row.id === 'proofs' && (
                          <>
                            {/* Guidebook — cover, spine, and text lines, t.e. guides. */}
                            <rect className="cls-line" x={4} y={3} width={16} height={18} rx={0.5} />
                            <line className="cls-line" x1={7} y1={3} x2={7} y2={21} />
                            <line className="cls-line" x1={9.5} y1={8} x2={17.5} y2={8} />
                            <line className="cls-line" x1={9.5} y1={11} x2={17.5} y2={11} />
                            <line className="cls-line" x1={9.5} y1={14} x2={15} y2={14} />
                          </>
                        )}
                      </g>
                    </g>
                  )
                })}
              </g>

              <g id="text" pointerEvents="none">
                {visibleRows.map((row, i) => {
                  const rowY = TOP_Y + i * ROW_H
                  return (
                    <text
                      key={`t-${row.id}`}
                      data-row={row.id}
                      x={56}
                      y={rowY + 40}
                      dominantBaseline="middle"
                      fill="currentColor"
                      className={
                        row.isActive
                          ? 'text-[rgb(43_57_144)]'
                          : 'text-gray-700'
                      }
                    >
                      {row.label}
                    </text>
                  )
                })}
              </g>

              <g id="links">
                {visibleRows.map((row, i) => {
                  const rowY = TOP_Y + i * ROW_H
                  return (
                    <foreignObject
                      key={`l-${row.id}`}
                      x={0}
                      y={rowY + 8}
                      width={264}
                      height={64}
                    >
                      <Link
                        href={row.href}
                        title={row.label}
                        aria-label={row.label}
                        data-discover="true"
                        data-row={row.id}
                        aria-current={row.isActive ? 'page' : undefined}
                        tabIndex={drawer.open ? 0 : -1}
                        className="block h-full w-full cursor-pointer"
                      >
                        <span className="sr-only">{row.label}</span>
                      </Link>
                    </foreignObject>
                  )
                })}
              </g>
            </svg>
          )}

          {extraItems.length > 0 && (
            <ul className="mt-1 space-y-1">
              {extraItems.map((item) => {
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
          )}
        </nav>

        {customer.companyName && (
          <div className="border-t border-gray-200/70 px-5 py-4">
            <p className="truncate text-sm font-medium text-gray-900">
              {customer.firstName} {customer.lastName}
            </p>
            <p className="truncate text-xs text-gray-500">{customer.companyName}</p>
          </div>
        )}
      </aside>

      {/* Main content — offset by the floating top bar height */}
      <main id="main-content" className="w-full pt-[var(--portal-topbar-h,76px)]">
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
