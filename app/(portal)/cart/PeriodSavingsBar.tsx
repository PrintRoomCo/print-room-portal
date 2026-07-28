'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useCurrency } from '@/contexts/CurrencyContext'

interface SummaryItem {
  catalogueItemId: string
  aggQty: number | null
  unitsToNextBreak: number | null
  nextUnitPrice: number | null
  perUnitSavings: number | null
  franchiseSavings: number | null
}

interface Summary {
  period: { id: string; closesAt: string } | null
  items: SummaryItem[]
}

interface CartSavingsItem {
  catalogueItemId: string
  productName: string
  qty: number
}

export function PeriodSavingsBar({
  cartItems,
  compact = false,
}: {
  cartItems: CartSavingsItem[]
  /** Compact mode — used in the cart drawer where space is constrained. */
  compact?: boolean
}) {
  const { format } = useCurrency()
  const detailsId = useId()
  const [expanded, setExpanded] = useState(false)
  const [result, setResult] = useState<{
    requestUrl: string
    summary: Summary | null
  } | null>(null)
  const groupedItems = useMemo(() => {
    const grouped = new Map<string, CartSavingsItem>()
    for (const item of cartItems) {
      const existing = grouped.get(item.catalogueItemId)
      if (existing) {
        existing.qty += item.qty
      } else {
        grouped.set(item.catalogueItemId, { ...item })
      }
    }
    return [...grouped.values()].sort((a, b) =>
      a.catalogueItemId.localeCompare(b.catalogueItemId),
    )
  }, [cartItems])
  const requestKey = groupedItems
    .map((item) => `${item.catalogueItemId}:${item.qty}`)
    .join('|')
  const requestUrl = useMemo(() => {
    if (!requestKey) return ''
    const params = new URLSearchParams()
    for (const item of groupedItems) {
      params.append('item', `${item.catalogueItemId}:${item.qty}`)
    }
    return `/api/period/summary?${params.toString()}`
  }, [groupedItems, requestKey])

  useEffect(() => {
    if (!requestUrl) return
    let alive = true
    fetch(requestUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((summary) => alive && setResult({ requestUrl, summary }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [requestUrl])

  const summary = result?.requestUrl === requestUrl ? result.summary : null
  if (!summary?.period) return null
  const summaryByItem = new Map(
    summary.items.map((item) => [item.catalogueItemId, item]),
  )
  const targets = groupedItems.flatMap((cartItem) => {
    const progress = summaryByItem.get(cartItem.catalogueItemId)
    return progress?.unitsToNextBreak != null &&
      progress.unitsToNextBreak > 0 &&
      progress.nextUnitPrice != null &&
      progress.perUnitSavings != null &&
      progress.perUnitSavings > 0 &&
      progress.franchiseSavings != null
      ? [{ cartItem, progress }]
      : []
  })
  if (targets.length === 0) return null

  const closes = new Date(summary.period.closesAt).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
  })

  return (
    <div
      className={
        compact
          ? 'mb-3 rounded-2xl bg-[rgb(var(--accent-mint))] px-4 py-3 text-xs leading-5 text-[rgb(var(--accent-mint-ink))]'
          : 'mb-6 rounded-[24px] bg-[rgb(var(--accent-mint))] p-5 text-sm leading-6 text-[rgb(var(--accent-mint-ink))]'
      }
      role="status"
      aria-label="Pre-order savings"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--accent-mint))]"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="text-sm font-medium">Network Price Progress</span>
        <span className="flex shrink-0 items-center gap-2 text-black/60">
          <span>
            {targets.length} {targets.length === 1 ? 'product' : 'products'}
          </span>
          <svg
            aria-hidden="true"
            className={`h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              expanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {expanded && (
        <ul id={detailsId} className="mt-4 space-y-4">
          {targets.map(({ cartItem, progress }) => (
            <li key={cartItem.catalogueItemId}>
              <p>
                <span className="font-medium">
                  {progress.unitsToNextBreak} more units of {cartItem.productName}
                </span>{' '}
                by {closes} unlocks {format(progress.nextUnitPrice!)} each.
              </p>
              <p className="mt-1 text-black/70">
                Your franchise&apos;s {cartItem.qty}-unit order will save{' '}
                <span className="font-semibold text-black">
                  {format(progress.franchiseSavings!)}
                </span>{' '}
                at that tier ({format(progress.perUnitSavings!)} per unit).
                {progress.aggQty != null
                  ? ` Network total after checkout: ${progress.aggQty + cartItem.qty}.`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
