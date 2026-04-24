'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import type { CartLine } from '@/lib/cart/types'

interface CartTableProps {
  lines: CartLine[]
  onUpdateQty: (lineId: string, qty: number) => void
  onRemove: (lineId: string) => void
  /** Reports to parent so it can disable "Proceed to checkout" when any line oversells. */
  onOversellChange?: (anyOversell: boolean) => void
}

type AvailabilityMap = Record<string, number | undefined>

export function CartTable({
  lines,
  onUpdateQty,
  onRemove,
  onOversellChange,
}: CartTableProps) {
  const [availability, setAvailability] = useState<AvailabilityMap>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (lines.length === 0) {
      setAvailability({})
      onOversellChange?.(false)
      return
    }
    const productIds = Array.from(new Set(lines.map((l) => l.productId)))
    let cancelled = false
    setLoading(true)
    Promise.all(
      productIds.map(async (id) => {
        try {
          const res = await fetch(`/api/shop/products/${id}/availability`)
          if (!res.ok) return {} as Record<string, number>
          const { availability: a } = (await res.json()) as {
            availability: Record<string, number>
          }
          return a
        } catch {
          return {} as Record<string, number>
        }
      })
    ).then((maps) => {
      if (cancelled) return
      const merged: AvailabilityMap = {}
      for (const m of maps) for (const k of Object.keys(m)) merged[k] = m[k]
      setAvailability(merged)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [lines, onOversellChange])

  useEffect(() => {
    const oversells = lines.some((l) => {
      const avail = availability[l.variantId]
      return avail !== undefined && l.qty > avail
    })
    onOversellChange?.(oversells)
  }, [lines, availability, onOversellChange])

  if (lines.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500">
        Your cart is empty.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Qty</th>
            <th className="px-4 py-3">Unit</th>
            <th className="px-4 py-3">Total</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map((line) => {
            const avail = availability[line.variantId]
            const isOversell = avail !== undefined && line.qty > avail
            return (
              <tr
                key={line.lineId}
                className={isOversell ? 'bg-red-50' : undefined}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gray-50">
                      {line.imageUrl ? (
                        <Image
                          src={line.imageUrl}
                          alt={line.productName}
                          fill
                          sizes="48px"
                          className="object-contain p-1"
                          unoptimized
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-900">{line.productName}</div>
                      <div className="truncate text-xs text-gray-500">{line.variantLabel}</div>
                      {isOversell && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-red-700">
                          <span>Only {avail} available.</span>
                          <button
                            type="button"
                            onClick={() => onUpdateQty(line.lineId, avail ?? 0)}
                            className="rounded-full border border-red-300 bg-white px-2 py-0.5 font-medium text-red-700 hover:bg-red-50"
                          >
                            Reduce to {avail}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={1}
                    value={line.qty}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (Number.isInteger(next) && next > 0) onUpdateQty(line.lineId, next)
                    }}
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30"
                  />
                </td>
                <td className="px-4 py-3 text-gray-700">${line.unitPrice.toFixed(2)}</td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  ${(line.unitPrice * line.qty).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(line.lineId)}
                    className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Remove line"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {loading && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
          Checking availability…
        </div>
      )}
    </div>
  )
}
