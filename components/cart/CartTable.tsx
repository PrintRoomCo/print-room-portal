'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import {
  allInLineTotal,
  allInUnitPrice,
  cartLineDisplayImageUrl,
  type CartLine,
} from '@/lib/cart/types'
import { pillsFor, PILL_LABELS } from '@/lib/shop/fulfilment-mode'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { useCurrency } from '@/contexts/CurrencyContext'
import type { VariantAvailability } from '@/lib/shop/variant-availability'
import { useCartLineFrontImages } from './useCartLineFrontImages'

interface CartTableProps {
  lines: CartLine[]
  onUpdateQty: (lineId: string, qty: number) => void
  onRemove: (lineId: string) => void
  /** Reports to parent so it can disable "Proceed to checkout" when any line oversells. */
  onOversellChange?: (anyOversell: boolean) => void
  /** Reports to parent so it can disable "Proceed to checkout" when any line is below MOQ. */
  onMoqViolationChange?: (anyShort: boolean) => void
  /** Reports a per-line order-type (fulfilment) change from the selector. */
  onFulfilmentChange?: (lineId: string, fulfilmentType: 'stocked' | 'made_to_order') => void
  /** Gates the per-line order-type selector to org admins (Spec B / F1). */
  isOrgAdmin?: boolean
}

type AvailabilityMap = Record<string, number | undefined>
type MoqMap = Record<string, number | undefined>
// Soft per-order cap per productId — advisory only, never gates checkout.
type MaxQtyMap = Record<string, number | undefined>

export function CartTable({
  lines,
  onUpdateQty,
  onRemove,
  onOversellChange,
  onMoqViolationChange,
  onFulfilmentChange,
  isOrgAdmin = false,
}: CartTableProps) {
  const { format } = useCurrency()
  const [availability, setAvailability] = useState<AvailabilityMap>({})
  const [moqByProduct, setMoqByProduct] = useState<MoqMap>({})
  const [maxQtyByProduct, setMaxQtyByProduct] = useState<MaxQtyMap>({})
  const [loading, setLoading] = useState(false)
  const frontImageByLineId = useCartLineFrontImages(lines)

  useEffect(() => {
    if (lines.length === 0) {
      setAvailability({})
      setMoqByProduct({})
      setMaxQtyByProduct({})
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
          const empty = {
            productId: id,
            availability: {} as Record<string, number>,
            effectiveMoq: undefined,
            effectiveMaxQty: undefined,
          }
          if (!res.ok) return empty
          const { availability: a, effectiveMoq, effectiveMaxQty } = (await res.json()) as {
            availability: Record<string, VariantAvailability>
            effectiveMoq?: number
            effectiveMaxQty?: number | null
          }
          const collapsed: Record<string, number> = {}
          for (const [k, v] of Object.entries(a ?? {})) collapsed[k] = v.available_qty
          return { productId: id, availability: collapsed, effectiveMoq, effectiveMaxQty }
        } catch {
          return {
            productId: id,
            availability: {} as Record<string, number>,
            effectiveMoq: undefined,
            effectiveMaxQty: undefined,
          }
        }
      })
    ).then((results) => {
      if (cancelled) return
      const mergedAvail: AvailabilityMap = {}
      const mergedMoq: MoqMap = {}
      const mergedMaxQty: MaxQtyMap = {}
      for (const r of results) {
        for (const k of Object.keys(r.availability)) mergedAvail[k] = r.availability[k]
        if (typeof r.effectiveMoq === 'number') mergedMoq[r.productId] = r.effectiveMoq
        if (typeof r.effectiveMaxQty === 'number') mergedMaxQty[r.productId] = r.effectiveMaxQty
      }
      setAvailability(mergedAvail)
      setMoqByProduct(mergedMoq)
      setMaxQtyByProduct(mergedMaxQty)
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
        // Selector only for a mixed-nature line an org admin can steer both ways.
        const showFulfilmentSelector =
          pillsFor(line.nature ?? 'made_to_order', isOrgAdmin).length === 2
        const isStockMode = line.fulfilmentType === 'stocked'
        const isOversell = !isMadeToOrder && avail !== undefined && line.qty > avail
        const moq = moqByProduct[line.productId]
        const totalForProduct = qtyByProduct.get(line.productId) ?? line.qty
        const isMoqShort = moq !== undefined && moq > 1 && totalForProduct < moq
        // Soft cap — advisory note only; must never feed the checkout gates.
        const maxQty = maxQtyByProduct[line.productId]
        const isOverMax = maxQty !== undefined && totalForProduct > maxQty
        const unitPrice = allInUnitPrice(line)
        const lineTotal = allInLineTotal(line)
        const imageUrl = cartLineDisplayImageUrl(line, {
          catalogueFrontImageUrl: frontImageByLineId[line.lineId] ?? null,
        })
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
                <p className="mt-1 text-sm text-gray-500">{line.variantLabel}</p>
              </div>

              {/* Remove */}
              <button
                type="button"
                onClick={() => onRemove(line.lineId)}
                className="shrink-0 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
              >
                Remove
              </button>
            </div>

            {/* Per-line order-type selector (mixed-nature lines, org admins only) */}
            {showFulfilmentSelector && (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <span className="text-xs text-gray-500">Order type</span>
                <div
                  className="inline-flex rounded-full bg-gray-100 p-0.5"
                  role="group"
                  aria-label="Order type"
                >
                  <button
                    type="button"
                    onClick={() => onFulfilmentChange?.(line.lineId, 'made_to_order')}
                    aria-pressed={!isStockMode}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      !isStockMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {PILL_LABELS.reorder}
                  </button>
                  <button
                    type="button"
                    onClick={() => onFulfilmentChange?.(line.lineId, 'stocked')}
                    aria-pressed={isStockMode}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      isStockMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {PILL_LABELS.from_inventory}
                  </button>
                </div>
              </div>
            )}

            {/* Inline status messages */}
            {(isOversell || isMoqShort || isOverMax) && (
              <div className="mt-4 space-y-1.5 border-t border-gray-100 pt-3 text-xs">
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
                {isOverMax && maxQty !== undefined && (
                  <p className="text-amber-700">
                    Over the per-order limit ({maxQty} units) — currently {totalForProduct}{' '}
                    across this product. You can still check out.
                  </p>
                )}
              </div>
            )}

            {/* Quantity + price row */}
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-1.5">
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
              <div className="text-right">
                <p className="text-xs text-gray-500">
                  Unit · <span className="tabular-nums text-gray-700">{format(unitPrice)}</span>
                </p>
                <p className="font-dm-sans text-base font-medium text-gray-900 tabular-nums">
                  {format(lineTotal)}
                </p>
              </div>
            </div>
          </article>
        )
      })}

      {loading && (
        <p className="px-2 text-[11px] font-medium text-gray-500">Checking availability…</p>
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
