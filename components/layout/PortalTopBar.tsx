'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
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
  'rounded-full bg-gray-50 border border-gray-200 px-3 py-1.5 text-xs w-auto min-w-[9rem] focus:outline-none focus:ring-2 focus:ring-gray-300'

export function PortalTopBar() {
  const pathname = usePathname() ?? ''
  const ctx = useTopBarContextValue()
  const drawer = usePortalDrawer()

  const hasFilterRow = !!(
    ctx?.kind === 'listing' &&
    ctx.filters &&
    ctx.facets &&
    ctx.filterAction
  )

  // Publish total bar height as a CSS variable so the main content can offset
  // its top padding. 76px = 12px inset + 56px pill + 8px gap. With the filter
  // row, add ~60px for the 2nd-row form + padding.
  useEffect(() => {
    const h = hasFilterRow ? '136px' : '76px'
    document.documentElement.style.setProperty('--portal-topbar-h', h)
  }, [hasFilterRow])

  return (
    <header
      role="banner"
      className="fixed inset-x-3 top-3 z-30 overflow-hidden rounded-2xl border border-gray-200/70 bg-white/75 shadow-sm backdrop-blur-md transition-shadow duration-200"
    >
      <div className="flex h-14 items-center px-3 md:px-4">
        {/* Menu trigger */}
        <button
          type="button"
          onClick={drawer.toggle}
          aria-label="Open navigation menu"
          aria-expanded={drawer.open ? ('true' as const) : ('false' as const)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition-all duration-150 hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-1"
        >
          <MenuIcon className="h-4 w-4" />
        </button>

        {/* Left: contextual stat block (desktop only) */}
        <div className="ml-3 hidden min-w-0 flex-1 items-center md:flex">
          <ContextBlock ctx={ctx} pathname={pathname} />
        </div>

        {/* Spacer on mobile */}
        <div className="flex-1 md:hidden" />

        {/* Centre: brand */}
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
          <span className="hidden text-sm font-medium lowercase tracking-tight text-pr-blue sm:inline">
            the print room
          </span>
        </Link>

        {/* Right: cart + currency + account */}
        <div className="ml-3 flex min-w-0 flex-1 items-center justify-end gap-2 md:gap-3">
          <TopBarCartPill />
          <CurrencyPicker />
          <AccountMenu />
        </div>
      </div>

      {/* Optional second row: catalogue filter form. Always rendered when
          listing context publishes filters, animated via grid-rows trick so
          the bar can smoothly grow. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          hasFilterRow ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {ctx?.kind === 'listing' && ctx.filters && ctx.facets && ctx.filterAction && (
            <FilterRow
              filters={ctx.filters}
              facets={ctx.facets}
              action={ctx.filterAction}
            />
          )}
        </div>
      </div>
    </header>
  )
}

function FilterRow({
  filters,
  facets,
  action,
}: {
  filters: NonNullable<
    Extract<PortalTopBarContextValue, { kind: 'listing' }>['filters']
  >
  facets: NonNullable<
    Extract<PortalTopBarContextValue, { kind: 'listing' }>['facets']
  >
  action: string
}) {
  const hasActive = activeFilterCount(filters) > 0

  return (
    <div className="border-t border-gray-200/70 px-3 py-2 md:px-4">
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
          className="min-w-[10rem] flex-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300"
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
            className="ml-auto text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 hover:text-gray-900"
          >
            Clear all
          </Link>
        )}

        <noscript>
          <button
            type="submit"
            className="rounded-full bg-pr-blue px-3 py-1.5 text-xs text-white"
          >
            Apply filters
          </button>
        </noscript>
      </form>
    </div>
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

function StatRow({ cells }: { cells: Array<{ label: string; value: string }> }) {
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

function formatType(t: string | null): string {
  if (!t) return '—'
  return t.replace(/_/g, ' ').toUpperCase()
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  )
}
