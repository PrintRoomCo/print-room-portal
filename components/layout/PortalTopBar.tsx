'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  useTopBarContextValue,
  usePortalDrawer,
  type PortalTopBarContextValue,
} from './PortalTopBarContext'
import { useCompany } from '@/contexts/CompanyContext'
import { CurrencyPicker } from './CurrencyPicker'
import { TopBarCartPill } from './TopBarCartPill'
import { AccountMenu } from './AccountMenu'
import { FilterAutoSubmitSelect } from '@/components/shop/FilterAutoSubmitSelect'
import { FilterAutoSubmitCheckbox } from '@/components/shop/FilterAutoSubmitCheckbox'
import { activeFilterCount } from '@/lib/shop/filter-params'

export function PortalTopBar() {
  const ctx = useTopBarContextValue()
  const drawer = usePortalDrawer()
  const { access } = useCompany()
  const orgLogoUrl = access?.logoUrl ?? null

  const hasFilterRow = !!(
    ctx?.kind === 'listing' &&
    ctx.filters &&
    ctx.facets &&
    ctx.filterAction
  )

  // Publish total bar height as a CSS variable so Sidebar's main content can
  // offset its top padding. 76px = 12px inset + 56px pill + 8px gap. With the
  // filter row, add ~60px for the 2nd-row form + padding.
  useEffect(() => {
    const h = hasFilterRow ? '136px' : '76px'
    document.documentElement.style.setProperty('--portal-topbar-h', h)
  }, [hasFilterRow])

  // The filter-row wrapper must clip (`overflow-hidden`) during the
  // grid-template-rows transition (0fr → 1fr) so collapsed content stays
  // hidden. Once the row is fully open and the transition has settled, we
  // flip to `overflow-visible` so the FilterAutoSubmitSelect popovers can
  // hang below the top bar without being clipped at its bottom edge.
  // Transition duration is 200ms; 220ms buffers a frame for safety.
  const [rowSettled, setRowSettled] = useState(false)
  useEffect(() => {
    if (!hasFilterRow) {
      setRowSettled(false)
      return
    }
    const t = setTimeout(() => setRowSettled(true), 220)
    return () => clearTimeout(t)
  }, [hasFilterRow])

  return (
    <header
      role="banner"
      data-vt-name="topbar"
      className="fixed inset-x-3 top-3 z-30 overflow-visible rounded-2xl border border-gray-200/70 bg-white/75 shadow-sm backdrop-blur-md transition-shadow duration-200"
    >
      <div className="relative z-20 flex h-14 items-center px-3 md:px-4">
        {/* Menu trigger — toggles the Sidebar drawer */}
        <button
          type="button"
          onClick={drawer.toggle}
          aria-label="Open navigation menu"
          aria-expanded={drawer.open}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-all duration-150 hover:bg-gray-200 active:scale-[0.98]"
        >
          <MenuIcon className="h-4 w-4" />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Centre: brand mark. Org admins can replace the Print Room mark with
            their own logo (see AccountClient → Organisation logo). The org logo
            gets a wider slot for wordmark-style logos and is served unoptimized
            so any aspect ratio / SVG renders without next.config image tweaks. */}
        <Link
          href="/account"
          aria-label={orgLogoUrl ? (access?.companyName ?? 'Home') : 'The Print Room'}
          className="flex shrink-0 items-center"
        >
          {orgLogoUrl ? (
            <Image
              src={orgLogoUrl}
              alt={access?.companyName ?? ''}
              width={140}
              height={28}
              priority
              unoptimized
              className="h-7 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <Image
              src="/print-room-logo.png"
              alt=""
              width={28}
              height={28}
              priority
              className="h-7 w-7 object-contain"
            />
          )}
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: cart + currency + account */}
        <div className="flex shrink-0 items-center gap-2">
          <TopBarCartPill />
          <CurrencyPicker />
          <AccountMenu />
        </div>
      </div>

      {/* Optional second row: catalogue filter form. Rendered when the
          listing context publishes filters, animated via grid-rows trick so
          the bar can smoothly grow. */}
      <div
        className={`relative z-10 grid transition-[grid-template-rows] duration-200 ease-out ${
          hasFilterRow ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className={rowSettled ? 'overflow-visible' : 'overflow-hidden'}>
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
          className="min-w-[10rem] flex-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-500 transition-colors hover:bg-gray-200 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
        />

        <FilterAutoSubmitSelect
          name="brand_id"
          defaultValue={filters.brandId ?? ''}
          ariaLabel="Filter by brand"
          options={[
            { value: '', label: 'All brands' },
            ...facets.brands.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />

        <FilterAutoSubmitSelect
          name="category_id"
          defaultValue={filters.categoryId ?? ''}
          ariaLabel="Filter by category"
          options={[
            { value: '', label: 'All categories' },
            ...facets.categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        <FilterAutoSubmitSelect
          name="sort"
          defaultValue={filters.sort}
          ariaLabel="Sort"
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
            className="ml-auto text-[11px] font-medium tracking-[0.12em] text-gray-500 hover:text-gray-900"
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
