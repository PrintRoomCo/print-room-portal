'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { decorationPerUnit, type CartLine } from '@/lib/cart/types'
import { formatPrice } from '@/lib/format/price'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'

interface CartTableProps {
  lines: CartLine[]
  onUpdateQty: (lineId: string, qty: number) => void
  onRemove: (lineId: string) => void
  /** Reports to parent so it can disable "Proceed to checkout" when any line oversells. */
  onOversellChange?: (anyOversell: boolean) => void
  /** Reports to parent so it can disable "Proceed to checkout" when any line is below MOQ. */
  onMoqViolationChange?: (anyShort: boolean) => void
}

type AvailabilityMap = Record<string, number | undefined>
type MoqMap = Record<string, number | undefined>

export function CartTable({
  lines,
  onUpdateQty,
  onRemove,
  onOversellChange,
  onMoqViolationChange,
}: CartTableProps) {
  const [availability, setAvailability] = useState<AvailabilityMap>({})
  const [moqByProduct, setMoqByProduct] = useState<MoqMap>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (lines.length === 0) {
      setAvailability({})
      setMoqByProduct({})
      onOversellChange?.(false)
      onMoqViolationChange?.(false)
      return
    }
    const productIds = Array.from(new Set(lines.map((l) => l.productId)))
    let cancelled = false
    setLoading(true)
    Promise.all(
      productIds.map(async (id) => {
        try {
          const res = await fetch(`/api/shop/products/${id}/availability`)
          if (!res.ok) return { productId: id, availability: {} as Record<string, number>, effectiveMoq: undefined }
          const { availability: a, effectiveMoq } = (await res.json()) as {
            availability: Record<string, number>
            effectiveMoq?: number
          }
          return { productId: id, availability: a, effectiveMoq }
        } catch {
          return { productId: id, availability: {} as Record<string, number>, effectiveMoq: undefined }
        }
      })
    ).then((results) => {
      if (cancelled) return
      const mergedAvail: AvailabilityMap = {}
      const mergedMoq: MoqMap = {}
      for (const r of results) {
        for (const k of Object.keys(r.availability)) mergedAvail[k] = r.availability[k]
        if (typeof r.effectiveMoq === 'number') mergedMoq[r.productId] = r.effectiveMoq
      }
      setAvailability(mergedAvail)
      setMoqByProduct(mergedMoq)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [lines, onOversellChange, onMoqViolationChange])

  useEffect(() => {
    // Only stocked lines block checkout on oversell — make_to_stock lines are
    // intentionally over-available and route to production instead.
    const oversells = lines.some((l) => {
      if (l.fulfilmentType === 'make_to_stock') return false
      const avail = availability[l.variantId]
      return avail !== undefined && l.qty > avail
    })
    onOversellChange?.(oversells)
  }, [lines, availability, onOversellChange])

  // MOQ on B2B is per-product (across all sizes/variants of the same product),
  // matching the PDP rule for multi-size: the qty floor is summed across every
  // line that shares productId. Mirroring it here keeps cart and PDP consistent.
  const qtyByProduct = new Map<string, number>()
  for (const l of lines) {
    qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + l.qty)
  }

  useEffect(() => {
    const shortByProduct = new Map<string, boolean>()
    for (const [pid, totalQty] of qtyByProduct) {
      const moq = moqByProduct[pid]
      if (moq !== undefined && moq > 1 && totalQty < moq) {
        shortByProduct.set(pid, true)
      }
    }
    onMoqViolationChange?.(shortByProduct.size > 0)
    // qtyByProduct is rebuilt every render — depend on the inputs that drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, moqByProduct, onMoqViolationChange])

  if (lines.length === 0) {
    return (
      <PortalEmptyState
        title="Your cart is empty"
        body="Start from your catalogue and add products when you are ready to place an order."
        actionHref="/shop"
        actionLabel="Browse catalogue"
      />
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
            const isMakeToStock = line.fulfilmentType === 'make_to_stock'
            // Oversell only applies to stocked lines; make_to_stock lines are
            // intentionally ordering beyond available stock.
            const isOversell = !isMakeToStock && avail !== undefined && line.qty > avail
            const moq = moqByProduct[line.productId]
            const totalForProduct = qtyByProduct.get(line.productId) ?? line.qty
            const isMoqShort = moq !== undefined && moq > 1 && totalForProduct < moq
            return (
              <tr
                key={line.lineId}
                className={isOversell || isMoqShort ? 'bg-red-50' : isMakeToStock ? 'bg-amber-50/40' : undefined}
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
                      {line.decorations.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {line.decorations.map((d) => (
                            <span
                              key={d.linkId}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700"
                              title={`${d.name} · +${formatPrice(d.unitPrice)} / unit`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={d.snapshotUrl ?? d.artworkUrl}
                                alt=""
                                className="h-4 w-4 rounded-sm object-contain bg-white"
                              />
                              <span className="font-medium">{d.name}</span>
                              <span className="tabular-nums text-gray-500">
                                +{formatPrice(d.unitPrice)}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                      {isMakeToStock && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium">
                            Make to stock
                          </span>
                          <span className="text-amber-600">— will go to your inventory shelf</span>
                        </div>
                      )}
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
                      {isMoqShort && moq !== undefined && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-red-700">
                          <span>
                            Below minimum order ({moq} units) — currently {totalForProduct}{' '}
                            across this product.
                          </span>
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
                <td className="px-4 py-3 text-gray-700">{formatPrice(line.unitPrice)}</td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {formatPrice(line.qty * (line.unitPrice + decorationPerUnit(line)))}
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
