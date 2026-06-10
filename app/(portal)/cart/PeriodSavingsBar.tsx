'use client'

import { useEffect, useState } from 'react'

interface SummaryItem {
  catalogueItemId: string
  aggQty: number | null
  unitsToNextBreak: number | null
  currentUnitPrice: number | null
  nextUnitPrice: number | null
}

interface Summary {
  period: { id: string; closesAt: string } | null
  items: SummaryItem[]
}

export function PeriodSavingsBar({
  cartCatalogueItemIds,
}: {
  cartCatalogueItemIds: string[]
}) {
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/period/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => alive && setSummary(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!summary?.period) return null
  const inCart = new Set(cartCatalogueItemIds)
  const target = summary.items.find(
    (i) =>
      inCart.has(i.catalogueItemId) &&
      i.unitsToNextBreak != null &&
      i.unitsToNextBreak > 0 &&
      i.nextUnitPrice != null &&
      i.currentUnitPrice != null,
  )
  if (!target) return null

  const closes = new Date(summary.period.closesAt).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
  })
  const saving = (target.currentUnitPrice! - target.nextUnitPrice!).toFixed(2)

  return (
    <div
      className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900"
      role="status"
    >
      {target.unitsToNextBreak} more units across your network by {closes} drops
      the price by ${saving}/unit — every location&apos;s order counts.
      {target.aggQty != null ? ` Network total so far: ${target.aggQty}.` : ''}
    </div>
  )
}
