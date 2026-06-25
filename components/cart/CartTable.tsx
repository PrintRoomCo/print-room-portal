'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import {
  allInLineTotal,
  allInUnitPrice,
  cartLineDisplayImageUrl,
  type CartLine,
} from '@/lib/cart/types'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { useCurrency } from '@/contexts/CurrencyContext'
import type { VariantAvailability } from '@/lib/shop/variant-availability'

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

const LABEL_CAP =
  'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500'

export function CartTable({
  lines,
  onUpdateQty,
  onRemove,
  onOversellChange,
  onMoqViolationChange,
}: CartTableProps) {
  const { format } = useCurrency()
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
    // The endpoint returns Record<variantId, VariantAvailability> per
    // 2026-05-29 shape change; CartTable's oversell guard only needs the
    // numeric qty, so collapse to number at the boundary. Backorderable
    // lines bypass this guard via fulfilmentType === 'made_to_order' which
    // ProductDetailClient sets at PDP-add time.
    Promise.all(
      productIds.map(async (id) => {
        try {
          const res = await fetch(`/api/shop/products/${id}/availability`)
          const empty = { productId: id, availability: {} as Record<string, number>, effectiveMoq: undefined }
          if (!res.ok) return empty
          const { availability: a, effectiveMoq } = (await res.json()) as {
            availability: Record<string, VariantAvailability>
            effectiveMoq?: number
          }
          const collapsed: Record<string, number> = {}
          for (const [k, v] of Object.entries(a ?? {})) collapsed[k] = v.available_qty
          return { productId: id, availability: collapsed, effectiveMoq }
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
    const oversells = lines.some((l) => {
      if (l.fulfilmentType === 'made_to_order') return false
      const avail = availability[`${l.variantId}::${l.sizeId ?? ''}`]
      return avail !== undefined && l.qty > avail
    })
    onOversellChange?.(oversells)
  }, [lines, availability, onOversellChange])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, moqByProduct, onMoqViolationChange])

  if (lines.length === 0) {
    return (
      <PortalEmptyState
        title="Your cart is empty"
        body="Start from your catalogue and add products when you are ready to place an order."
        actionHref="/catalogue"
        actionLabel="Browse catalogue"
      />
    )
  }

  return (
    <div className="space-y-3">
      {lines.map((line) => {
        const avail = availability[`${line.variantId}::${line.sizeId ?? ''}`]
        const isMadeToOrder = line.fulfilmentType === 'made_to_order'
        const isOversell = !isMadeToOrder && avail !== undefined && line.qty > avail
        const moq = moqByProduct[line.productId]
        const totalForProduct = qtyByProduct.get(line.productId) ?? line.qty
        const isMoqShort = moq !== undefined && moq > 1 && totalForProduct < moq
        const unitPrice = allInUnitPrice(line)
        const lineTotal = allInLineTotal(line)
        const imageUrl = cartLineDisplayImageUrl(line)
        return (
          <article
            key={line.lineId}
            className="rounded-[24px] bg-white p-5 transition-colors md:p-6"
          >
            <div className="flex items-start gap-4 md:gap-5">
              {/* Image plate */}
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-gray-50 md:h-28 md:w-28">
                {imageUrl ? (
                  <Image
                    src={imageUrl}
                    alt={line.productName}
                    fill
                    sizes="(min-width: 768px) 112px, 96px"
                    className="object-contain p-2"
                    unoptimized
                  />
                ) : null}
              </div>

              {/* Detail column */}
              <div className="min-w-0 flex-1">
                <p className="font-dm-sans text-base font-medium text-gray-900 md:text-lg">
                  {line.productName}
                </p>
                <p className={`mt-1 ${LABEL_CAP}`}>{line.variantLabel}</p>
                {line.decorations.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {line.decorations.map((d) => {
                      const icon = d.snapshotUrl ?? d.artworkUrl
                      return (
                        <span
                          key={d.linkId}
                          className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-[11px] text-gray-700"
                          title={d.name}
                        >
                          {icon ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={icon}
                              alt=""
                              className="h-4 w-4 rounded-sm bg-white object-contain"
                            />
                          ) : null}
                          <span className="font-medium">{d.name}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Qty + remove column */}
              <div className="flex shrink-0 flex-col items-end gap-3">
                <div className="flex items-center gap-1">
                  <QtyChip
                    onClick={() => onUpdateQty(line.lineId, Math.max(1, line.qty - 1))}
                    disabled={line.qty <= 1}
                    label="Decrease quantity"
                  >
                    −
                  </QtyChip>
                  <input
                    type="number"
                    min={1}
                    value={line.qty}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (Number.isInteger(next) && next > 0) onUpdateQty(line.lineId, next)
                    }}
                    aria-label="Quantity"
                    className="w-14 rounded-full bg-gray-50 px-2 py-1.5 text-center text-sm tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  <QtyChip
                    onClick={() => onUpdateQty(line.lineId, line.qty + 1)}
                    label="Increase quantity"
                  >
                    +
                  </QtyChip>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(line.lineId)}
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 transition-colors hover:text-gray-900"
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Inline status messages */}
            {(isMadeToOrder || isOversell || isMoqShort) && (
              <div className="mt-4 space-y-1.5 border-t border-gray-100 pt-3 text-xs">
                {isMadeToOrder && (
                  <p className="text-amber-700">
                    <span className="font-medium">Made to order</span> — this will be
                    produced before dispatch.
                  </p>
                )}
                {isOversell && (
                  <p className="flex items-center gap-2 text-rose-700">
                    Only {avail} available.
                    <button
                      type="button"
                      onClick={() => onUpdateQty(line.lineId, avail ?? 0)}
                      className="rounded-full bg-rose-50 px-3 py-0.5 font-medium text-rose-700 transition-colors hover:bg-rose-100"
                    >
                      Reduce to {avail}
                    </button>
                  </p>
                )}
                {isMoqShort && moq !== undefined && (
                  <p className="text-rose-700">
                    Below minimum order ({moq} units) — currently {totalForProduct}{' '}
                    across this product.
                  </p>
                )}
              </div>
            )}

            {/* Price row */}
            <div className="mt-4 flex items-baseline justify-between border-t border-gray-100 pt-3 text-sm">
              <span className="text-gray-500">
                Unit · <span className="tabular-nums text-gray-700">{format(unitPrice)}</span>
              </span>
              <span className="font-dm-sans text-base font-medium text-gray-900 tabular-nums">
                {format(lineTotal)}
              </span>
            </div>
          </article>
        )
      })}

      {loading && (
        <p className={`px-2 ${LABEL_CAP}`}>Checking availability…</p>
      )}
    </div>
  )
}

function QtyChip({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-base text-gray-700 transition-all duration-150 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
