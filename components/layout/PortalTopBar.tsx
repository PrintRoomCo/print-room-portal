'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTopBarContextValue } from './PortalTopBarContext'
import { CurrencyPicker } from './CurrencyPicker'
import { TopBarCartPill } from './TopBarCartPill'
import { AccountMenu } from './AccountMenu'

// Pathname → section label fallback when no page-set context is present.
// Keep in sync with Sidebar navigation labels.
const SECTION_LABELS: Array<{ test: (p: string) => boolean; label: string }> = [
  { test: (p) => p === '/account' || p.startsWith('/account/'), label: 'Settings' },
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

export function PortalTopBar() {
  const pathname = usePathname() ?? ''
  const ctx = useTopBarContextValue()

  return (
    <header
      role="banner"
      className="fixed inset-x-0 top-0 z-30 hidden h-14 items-center border-b border-gray-100 bg-white px-4 md:flex md:px-6"
    >
      {/* Left: contextual 3-col stat block */}
      <div className="flex min-w-0 flex-1 items-center">
        <ContextBlock ctx={ctx} pathname={pathname} />
      </div>

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
        <span className="text-sm font-medium lowercase tracking-tight text-pr-blue">
          the print room
        </span>
      </Link>

      {/* Right: cart + currency + account dropdown */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        <TopBarCartPill />
        <CurrencyPicker />
        <AccountMenu />
      </div>
    </header>
  )
}

function ContextBlock({
  ctx,
  pathname,
}: {
  ctx: ReturnType<typeof useTopBarContextValue>
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
          {
            label: 'Products',
            value: `${ctx.count}`,
          },
          { label: 'Page', value: pageCell },
        ]}
      />
    )
  }

  const label = ctx?.kind === 'section' ? ctx.label : fallbackSectionLabel(pathname)
  if (!label) return null
  return (
    <StatRow
      cells={[{ label: 'Section', value: label }]}
    />
  )
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

function formatType(t: string | null): string {
  if (!t) return '—'
  return t.replace(/_/g, ' ').toUpperCase()
}
