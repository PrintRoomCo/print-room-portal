'use client'

import { useEffect, useMemo, useState } from 'react'
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
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/60">
        Network price progress
      </p>
      <ul className="mt-1.5 divide-y divide-black/10">
        {targets.map(({ cartItem, progress }) => (
          <li
            key={cartItem.catalogueItemId}
            className="py-2 first:pt-0 last:pb-0"
          >
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
    </div>
  )
}
