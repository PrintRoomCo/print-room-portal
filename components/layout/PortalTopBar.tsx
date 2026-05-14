'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import {
  useTopBarContextValue,
  usePortalDrawer,
  type PortalTopBarContextValue,
} from './PortalTopBarContext'
import { CurrencyPicker } from './CurrencyPicker'
import { TopBarCartPill } from './TopBarCartPill'
import { AccountMenu } from './AccountMenu'
import { FilterAutoSubmitSelect } from '@/components/shop/FilterAutoSubmitSelect'
import { FilterAutoSubmitCheckbox } from '@/components/shop/FilterAutoSubmitCheckbox'
import { activeFilterCount } from '@/lib/shop/filter-params'

// Pathname → section label fallback when no page-set context is present.
// Keep in sync with Sidebar navigation labels.
const SECTION_LABELS: Array<{ test: (p: string) => boolean; label: string }> = [
  { test: (p) => p === '/account' || p.startsWith('/account/'), label: 'My Account' },
  { test: (p) => p === '/tracking' || p.startsWith('/tracking/'), label: 'Tracking' },
  { test: (p) => p === '/catalogue', label: 'Catalogue' },
  { test: (p) => p.startsWith('/catalogue/'), label: 'Product' },
  { test: (p) => p === '/my-collections' || p.startsWith('/my-collections/'), label: 'Orders' },
  { test: (p) => p === '/proofs' || p.startsWith('/proofs/'), label: 'Proofs' },
  { test: (p) => p === '/leavers-quotes' || p.startsWith('/leavers-quotes/'), label: 'Leavers Quotes' },
  { test: (p) => p === '/cart', label: 'Cart' },
  { test: (p) => p === '/checkout' || p.startsWith('/checkout/'), label: 'Checkout' },
  { test: (p) => p === '/order-tracker' || p.startsWith('/order-tracker/'), label: 'Order Tracker' },
  { test: (p) => p.startsWith('/orders/'), label: 'Order' },
]

function fallbackSectionLabel(pathname: string): string {
  return SECTION_LABELS.find((s) => s.test(pathname))?.label ?? ''
}

const SELECT_CLASS =
  'rounded-full bg-white/70 border border-gray-200 px-3 py-1.5 text-xs w-auto min-w-[9rem]'

export function PortalTopBar() {
  const pathname = usePathname() ?? ''
  const ctx = useTopBarContextValue()
  const { toggle } = usePortalDrawer()

  // Listing context publishes filters → top bar grows a 2nd row with the form.
  const hasFilterRow =
    ctx?.kind === 'listing' && !!ctx.filters && !!ctx.facets

  // Publish total clearance (top inset + bar height) as a CSS var so the main
  // content can pad-top adaptively without knowing the route. Includes the
  // 12px top margin so callers can use it as a single offset.
  useEffect(() => {
    const root = document.documentElement
    const value = hasFilterRow ? '136px' : '76px'
    root.style.setProperty('--portal-topbar-h', value)
    return () => {
      root.style.removeProperty('--portal-topbar-h')
    }
  }, [hasFilterRow])

  return (
    <header
      role="banner"
      className="pointer-events-none fixed inset-x-3 top-3 z-30 hidden md:block"
    >
      <div className="pointer-events-auto rounded-2xl border border-gray-200/70 bg-white/75 shadow-sm backdrop-blur-md">
        {/* Row 1: menu + context | brand | cart + currency + account */}
        <div className="flex h-14 items-center px-4 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <button
              type="button"
              onClick={toggle}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition-colors hover:bg-gray-50"
            >
              <MenuIcon />
            </button>
            <ContextBlock ctx={ctx} pathname={pathname} />
          </div>

          <Link
            href="/account"
            aria-label="The Print Room"
            className="flex shrink-0 items-center gap-2"
          >
            <Image
              src="/print-room-logo.png"
              alt=""
              width={28}
              height={28}
              priority
              className="h-7 w-7 object-contain"
            />
            <span className="text-sm font-medium lowercase tracking-tight text-pr-blue">
              the print room
            </span>
          </Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
            <TopBarCartPill />
            <CurrencyPicker />
            <AccountMenu />
          </div>
        </div>

        {/* Row 2: filter form — only on listing pages that ship filters */}
        {hasFilterRow && ctx?.kind === 'listing' && ctx.filters && ctx.facets && (
          <FilterRow
            filters={ctx.filters}
            facets={ctx.facets}
            action={ctx.filterAction ?? pathname}
          />
        )}
      </div>
    </header>
  )
}

function ContextBlock({
  ctx,
  pathname,
}: {
  ctx: PortalTopBarContextValue | null
  pathname: string
}) {
  if (ctx?.kind === 'pdp') {
    return (
      <StatRow
        cells={[
          { label: 'Product', value: ctx.productName },
          { label: 'Type', value: formatType(ctx.type) },
          { label: 'Price', value: ctx.priceLabel ?? '—' },
        ]}
      />
    )
  }

  if (ctx?.kind === 'listing') {
    const pageCell =
      ctx.page && ctx.pageCount && ctx.pageCount > 0
        ? `${ctx.page} / ${ctx.pageCount}`
        : '—'
    return (
      <StatRow
        cells={[
          { label: 'Section', value: ctx.label },
          { label: 'Products', value: `${ctx.count}` },
          { label: 'Page', value: pageCell },
        ]}
      />
    )
  }

  const label = ctx?.kind === 'section' ? ctx.label : fallbackSectionLabel(pathname)
  if (!label) return null
  return <StatRow cells={[{ label: 'Section', value: label }]} />
}

function StatRow({
  cells,
}: {
  cells: Array<{ label: string; value: string }>
}) {
  return (
    <dl className="flex min-w-0 items-center gap-6 text-[10px] leading-tight">
      {cells.map((c, i) => (
        <div key={`${c.label}-${i}`} className="flex min-w-0 gap-2">
          <dt className="shrink-0 font-medium uppercase tracking-wider text-gray-400">
            {c.label}
          </dt>
          <dd className="min-w-0 truncate font-medium uppercase tracking-wider text-gray-900">
            {c.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function FilterRow({
  filters,
  facets,
  action,
}: {
  filters: NonNullable<Extract<PortalTopBarContextValue, { kind: 'listing' }>['filters']>
  facets: NonNullable<Extract<PortalTopBarContextValue, { kind: 'listing' }>['facets']>
  action: string
}) {
  const hasActive = activeFilterCount(filters) > 0
  return (
    <div className="border-t border-gray-200/70 px-4 py-2.5 md:px-6">
      <form
        method="GET"
        action={action}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Search products"
          aria-label="Search products"
          className="min-w-[10rem] flex-1 rounded-full border border-gray-200 bg-white/70 px-4 py-1.5 text-xs"
        />
        <FilterAutoSubmitSelect
          name="brand_id"
          defaultValue={filters.brandId ?? ''}
          ariaLabel="Filter by brand"
          className={SELECT_CLASS}
          options={[
            { value: '', label: 'All brands' },
            ...facets.brands.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
        <FilterAutoSubmitSelect
          name="category_id"
          defaultValue={filters.categoryId ?? ''}
          ariaLabel="Filter by category"
          className={SELECT_CLASS}
          options={[
            { value: '', label: 'All categories' },
            ...facets.categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <FilterAutoSubmitSelect
          name="garment_family"
          defaultValue={filters.garmentFamily ?? ''}
          ariaLabel="Filter by garment family"
          className={SELECT_CLASS}
          options={[
            { value: '', label: 'All families' },
            ...facets.garmentFamilies.map((g) => ({ value: g, label: g })),
          ]}
        />
        <FilterAutoSubmitSelect
          name="sort"
          defaultValue={filters.sort}
          ariaLabel="Sort"
          className={SELECT_CLASS}
          options={[
            { value: 'name', label: 'Name (A → Z)' },
            { value: 'newest', label: 'Newest' },
          ]}
        />
        <FilterAutoSubmitCheckbox
          name="in_stock"
          defaultChecked={filters.inStock}
          label="In stock only"
        />
        {hasActive && (
          <Link
            href={action}
            className="ml-auto text-xs font-medium text-gray-600 underline"
          >
            Clear all
          </Link>
        )}
        <noscript>
          <button
            type="submit"
            className="rounded-full bg-pr-blue px-4 py-1.5 text-xs text-white"
          >
            Apply
          </button>
        </noscript>
      </form>
    </div>
  )
}

function formatType(t: string | null): string {
  if (!t) return '—'
  return t.replace(/_/g, ' ').toUpperCase()
}

function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}
