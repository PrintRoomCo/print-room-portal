'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { decorationPerUnit, type CartLine } from '@/lib/cart/types'
import { useCurrency } from '@/contexts/CurrencyContext'
import type { StoreOption } from './ShipToRow'
import {
  allLinesUseCustomAddress,
  clearCheckoutReviewState,
  readCheckoutReviewState,
  type CheckoutReviewState,
} from './checkoutReviewState'

interface CheckoutReviewClientProps {
  stores: StoreOption[]
  customerCode: string | null
  paymentTerms: string | null
  defaultDepositPercent: number | null
}

interface CheckoutResponse {
  order_id: string
  order_ref: string
}

export function CheckoutReviewClient({
  stores,
  customerCode,
  paymentTerms,
  defaultDepositPercent,
}: CheckoutReviewClientProps) {
  const cart = useCart()
  const router = useRouter()
  const pricingCtx = usePricingContext()
  const { format } = useCurrency()
  const [reviewState, setReviewState] = useState<CheckoutReviewState | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)

  useEffect(() => {
    setReviewState(readCheckoutReviewState())
    setHydrated(true)
  }, [])

  const storeById = useMemo(() => {
    const map = new Map<string, StoreOption>()
    for (const store of stores) map.set(store.id, store)
    return map
  }, [stores])

  const breakdown = useMemo(
    () =>
      computeOrderBreakdown({
        lines: cart.lines.map((line) => ({
          qty: line.qty,
          unitEffective: line.unitPrice,
          decorationPerUnit: decorationPerUnit(line),
        })),
        gstRate: 0.15,
      }),
    [cart.lines],
  )
  const depositPct = defaultDepositPercent ?? 0
  const depositAmount = (breakdown.netSubtotal * depositPct) / 100

  const allCustom =
    reviewState != null && allLinesUseCustomAddress(cart.lines, reviewState.perLineShipTo)

  // Mixed-intent split. Mirrors the partitioning done in CheckoutClient via
  // splitCartByIntent — kept inline here as a CartLine-typed partition because
  // the review render needs the full CartLine (productName, decorations, qty,
  // unitPrice…), not the trimmed CheckoutLineInput shape the helper consumes.
  // Same predicate (`routeToInventory === true`); no fast-path on review,
  // because the order-level admin toggle has been retired (cluster 2.5).
  const customerCartLines = useMemo<CartLine[]>(
    () => cart.lines.filter((l) => l.routeToInventory !== true),
    [cart.lines],
  )
  const inventoryCartLines = useMemo<CartLine[]>(
    () => cart.lines.filter((l) => l.routeToInventory === true),
    [cart.lines],
  )
  const isSplit = customerCartLines.length > 0 && inventoryCartLines.length > 0

  function lineTotal(line: CartLine): number {
    return line.qty * (line.unitPrice + decorationPerUnit(line))
  }
  const customerSubtotal = useMemo(
    () => customerCartLines.reduce((sum, l) => sum + lineTotal(l), 0),
    [customerCartLines],
  )
  const inventorySubtotal = useMemo(
    () => inventoryCartLines.reduce((sum, l) => sum + lineTotal(l), 0),
    [inventoryCartLines],
  )
  const grandTotal = customerSubtotal + inventorySubtotal

  // One-line summary of the destination for the customer-bucket heading.
  // For the split case we lean on the existing address-render logic: when
  // every line uses a custom address, show that; otherwise show the first
  // customer line's store (every customer line in a split shares a store-
  // or-mix UX the user already saw on /checkout). We deliberately keep this
  // concise — the per-line ship-to table below repeats the detail.
  function summariseAddress(): string {
    if (!reviewState) return ''
    if (allCustom) {
      const a = reviewState.customAddress
      return [a.name, a.address, a.city, a.postal_code, a.country]
        .filter(Boolean)
        .join(', ')
    }
    const firstCustomerLine = customerCartLines[0]
    if (!firstCustomerLine) return ''
    const storeId = reviewState.perLineShipTo[firstCustomerLine.lineId]
    const store = storeId ? storeById.get(storeId) : null
    if (!store) return 'your selected store'
    return `${store.name ?? 'Store'}${store.city ? ` — ${store.city}` : ''}`
  }
  const customerAddressSummary = summariseAddress()

  async function confirmOrder() {
    if (!reviewState || cart.lines.length === 0) return

    const missingShipTo = cart.lines.some(
      (line) => !Object.prototype.hasOwnProperty.call(reviewState.perLineShipTo, line.lineId),
    )
    if (missingShipTo) {
      setBanner({
        kind: 'error',
        msg: 'Checkout details are out of date. Go back to checkout and review shipping again.',
      })
      return
    }

    if (allCustom) {
      const address = reviewState.customAddress
      if (!address.address || !address.city || !address.country) {
        setBanner({
          kind: 'error',
          msg: 'Custom shipping address is incomplete. Go back to checkout and fill in the required fields.',
        })
        return
      }
    }

    setSubmitting(true)
    setBanner(null)
    try {
      // Per-line `route_to_inventory` is the source of truth for split routing
      // (PDP toggle + cart-level fast-path both write to it). At this point
      // the order-level admin "send entire order to inventory" is fully
      // retired, so root-level `route_entire_order_to_inventory` is hard-
      // false. Cluster F (submit pipeline) will eventually drop the legacy
      // root `intent` field and read per-line — until then we keep `intent`
      // set to a sensible value so the existing server route doesn't see a
      // missing field: 'inventory' only when the entire cart is inventory-
      // routed, otherwise 'customer' (true for whole-customer AND mixed).
      const allInventory =
        cart.lines.length > 0 && cart.lines.every((l) => l.routeToInventory === true)
      const wireIntent: 'customer' | 'inventory' = allInventory ? 'inventory' : 'customer'
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: reviewState.idempotencyKey,
          required_by: reviewState.requiredBy || null,
          notes: reviewState.notes || null,
          intent: wireIntent,
          route_entire_order_to_inventory: false,
          lines: cart.lines.map((line) => ({
            product_id: line.productId,
            product_name: line.productName,
            variant_id: line.variantId || null,
            qty: line.qty,
            ship_to_store_id: allCustom ? null : reviewState.perLineShipTo[line.lineId] ?? null,
            cart_line_id: line.lineId,
            decorations: line.decorations,
            claimed_unit_price: line.unitPrice,
            has_brackets: Array.isArray(line.brackets) && line.brackets.length > 0,
            route_to_inventory: line.routeToInventory === true,
          })),
          custom_shipping_address: allCustom ? reviewState.customAddress : null,
        }),
      })

      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          drift?: Array<{
            cartLineId: string | null
            decorationName: string
            was: number
            now: number
            reason: string
          }>
          priceDrift?: Array<{
            cartLineId: string | null
            productId: string
            productName: string
            qty: number
            claimedUnitPrice: number
            canonicalUnitPrice: number
          }>
          violations?: Array<{
            cartLineId: string | null
            productId: string
            productName: string
            effectiveMoq: number
            totalQty: number
          }>
          detail?: {
            code?: 'insufficient_stock' | 'no_inventory'
            product_id?: string | null
            variant_id?: string | null
            available?: number
            requested?: number
          }
        }
        if (data.error === 'moq_violation' && data.violations) {
          const summary = data.violations
            .map((v) => `${v.productName}: ${v.totalQty} ordered, min ${v.effectiveMoq}`)
            .join('; ')
          setBanner({
            kind: 'error',
            msg:
              `Minimum order quantity not met. ${summary}. ` +
              `Add more to meet the minimum, or contact your account manager.`,
          })
          router.push('/cart')
          return
        }
        if (data.error === 'decoration_price_drift' && data.drift) {
          const summary = data.drift
            .map((d) => `${d.decorationName}: was $${d.was.toFixed(2)} -> now $${d.now.toFixed(2)} (${d.reason})`)
            .join('; ')
          setBanner({
            kind: 'error',
            msg: `Decoration pricing has changed - review your cart. ${summary}`,
          })
          router.push('/cart')
          return
        }
        if (data.error === 'unit_price_drift' && data.priceDrift) {
          const summary = data.priceDrift
            .map(
              (d) =>
                `${d.productName}: cart $${d.claimedUnitPrice.toFixed(2)} -> live $${d.canonicalUnitPrice.toFixed(2)}`,
            )
            .join('; ')
          setBanner({
            kind: 'error',
            msg: `Pricing has changed since you added these to your cart - review and resubmit. ${summary}`,
          })
          router.push('/cart')
          return
        }
        if (data.error === 'insufficient_stock' || data.error === 'no_inventory') {
          const offendingLine = cart.lines.find(
            (line) =>
              (line.variantId || null) === (data.detail?.variant_id ?? null) ||
              line.productId === data.detail?.product_id,
          )
          const lineLabel = offendingLine?.productName ?? 'A product in your cart'
          const msg =
            data.error === 'insufficient_stock'
              ? `Sorry, ${lineLabel} went out of stock` +
                (data.detail?.available != null && data.detail?.requested != null
                  ? ` - you asked for ${data.detail.requested}, only ${data.detail.available} available.`
                  : '.') +
                ' Please reduce the quantity or remove it.'
              : `Sorry, ${lineLabel} is not stocked for your account - please contact staff or remove it from your cart.`
          setBanner({ kind: 'error', msg })
          router.push('/cart')
          return
        }
        setBanner({
          kind: 'error',
          msg: 'Stock changed while you were checking out - please review your cart and try again.',
        })
        router.push('/cart')
        return
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }

      const result = (await res.json()) as CheckoutResponse
      clearCheckoutReviewState()
      cart.clear()
      router.push(`/checkout/confirmation/${result.order_id}`)
    } catch (error) {
      setBanner({ kind: 'error', msg: (error as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  if (cart.lines.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
          <header className="mb-10 md:mb-12">
            <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
              Review order
            </h1>
            <p className="mt-3 text-sm text-gray-600">
              Check shipping, options, and totals before placing the order.
            </p>
          </header>
          <PortalEmptyState
            title="Review is ready when your cart is"
            body="Add products from your catalogue, then return to checkout to review the order."
            actionHref="/catalogue"
            actionLabel="Browse catalogue"
          />
        </div>
      </div>
    )
  }

  if (hydrated && !reviewState) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
          <header className="mb-10 md:mb-12">
            <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
              Review order
            </h1>
            <p className="mt-3 text-sm text-gray-600">
              Check shipping, options, and totals before placing the order.
            </p>
          </header>
        <div className="space-y-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Checkout details are missing. Return to checkout, confirm shipping, then review
          the order.
        </div>
        <button
          type="button"
          onClick={() => router.push('/checkout')}
          className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90"
        >
          Back to checkout
        </button>
        </div>
        </div>
      </div>
    )
  }

  if (!reviewState) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
          <div className="rounded-[32px] bg-white p-7 text-sm text-gray-600 md:p-8">
            Loading review...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Review order
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            Check shipping, options, and totals before placing the order.
          </p>
        </header>

        <div className="space-y-6">
      {banner && (
        <div
          role={banner.kind === 'error' ? 'alert' : undefined}
          className={`rounded-xl border p-4 text-sm ${
            banner.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-sky-200 bg-sky-50 text-sky-900'
          }`}
        >
          {banner.msg}
        </div>
      )}

      {!customerCode && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Your account is pending setup - contact staff to assign your customer code before
          placing an order.
        </div>
      )}

      <section className="rounded-[32px] bg-white p-7 md:p-8">
        {isSplit ? (
          <>
            <h2 className="text-sm font-medium text-gray-700">Items</h2>
            <p className="mt-1 text-xs text-gray-500">
              This order will split into two — priced as separate production runs.
            </p>
            <div className="mt-4 divide-y divide-gray-200">
              <div className="pb-5">
                <h3 className="text-base font-semibold text-gray-900">
                  Shipping to {customerAddressSummary}
                </h3>
                <div className="mt-3 divide-y divide-gray-100">
                  {customerCartLines.map((line) => (
                    <article key={line.lineId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="font-medium text-gray-900">{line.productName}</h4>
                          <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                            {line.variantLabel} · qty {line.qty}
                          </p>
                          {line.decorations.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-gray-600">
                              {line.decorations.map((decoration) => (
                                <li key={decoration.linkId}>
                                  {decoration.name} +{format(decoration.unitPrice)} / unit
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="text-right text-sm">
                          <p className="text-gray-500">Unit {format(line.unitPrice)}</p>
                          <p className="mt-1 font-semibold text-gray-900">
                            {format(lineTotal(line))}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="mt-3 flex justify-between border-t border-gray-100 pt-3 text-sm">
                  <span className="text-gray-500">Customer-ship subtotal</span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {format(customerSubtotal)}
                  </span>
                </div>
              </div>

              <div className="pt-5">
                <h3 className="text-base font-semibold text-gray-900">
                  Adding to your inventory shelf
                </h3>
                <div className="mt-3 divide-y divide-gray-100">
                  {inventoryCartLines.map((line) => (
                    <article key={line.lineId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="font-medium text-gray-900">{line.productName}</h4>
                          <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                            {line.variantLabel} · qty {line.qty}
                          </p>
                          <p className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-amber-700">
                            → INVENTORY
                          </p>
                          {line.decorations.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-gray-600">
                              {line.decorations.map((decoration) => (
                                <li key={decoration.linkId}>
                                  {decoration.name} +{format(decoration.unitPrice)} / unit
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="text-right text-sm">
                          <p className="text-gray-500">Unit {format(line.unitPrice)}</p>
                          <p className="mt-1 font-semibold text-gray-900">
                            {format(lineTotal(line))}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="mt-3 flex justify-between border-t border-gray-100 pt-3 text-sm">
                  <span className="text-gray-500">Inventory subtotal</span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {format(inventorySubtotal)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-between border-t border-gray-200 pt-4 text-base">
              <span className="font-semibold text-gray-900">Grand total</span>
              <span className="font-semibold text-gray-900 tabular-nums">
                {format(grandTotal)}
              </span>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-medium text-gray-700">Items</h2>
            <div className="mt-3 divide-y divide-gray-100">
              {cart.lines.map((line) => (
                <article key={line.lineId} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-gray-900">{line.productName}</h3>
                      <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                        {line.variantLabel} · qty {line.qty}
                      </p>
                      {line.routeToInventory === true && (
                        <p className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-amber-700">
                          → INVENTORY
                        </p>
                      )}
                      {line.decorations.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-gray-600">
                          {line.decorations.map((decoration) => (
                            <li key={decoration.linkId}>
                              {decoration.name} +{format(decoration.unitPrice)} / unit
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-gray-500">Unit {format(line.unitPrice)}</p>
                      <p className="mt-1 font-semibold text-gray-900">
                        {format(lineTotal(line))}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="rounded-[32px] bg-white p-7 md:p-8">
        <h2 className="text-sm font-medium text-gray-700">Shipping and options</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Order routing</dt>
            <dd className="text-right text-gray-900">
              {reviewState.intent === 'inventory' ? 'Add to my inventory' : 'Ship to customer'}
            </dd>
          </div>
          {allCustom ? (
            <div>
              <dt className="text-gray-500">Custom shipping address</dt>
              <dd className="mt-1 text-gray-900">
                {[
                  reviewState.customAddress.name,
                  reviewState.customAddress.address,
                  reviewState.customAddress.city,
                  reviewState.customAddress.postal_code,
                  reviewState.customAddress.country,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </dd>
            </div>
          ) : (
            cart.lines.map((line) => {
              const storeId = reviewState.perLineShipTo[line.lineId]
              const store = storeId ? storeById.get(storeId) : null
              return (
                <div key={line.lineId} className="flex justify-between gap-4">
                  <dt className="text-gray-500">{line.productName}</dt>
                  <dd className="text-right text-gray-900">
                    {store ? `${store.name ?? 'Store'}${store.city ? ` - ${store.city}` : ''}` : 'Not selected'}
                  </dd>
                </div>
              )
            })
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Required by</dt>
            <dd className="text-right text-gray-900">{reviewState.requiredBy || 'Not specified'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Notes</dt>
            <dd className="mt-1 text-gray-900">{reviewState.notes || 'None'}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[32px] bg-white p-7 md:p-8">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-gray-700">Pricing for</span>
          <TierBadge label={pricingCtx.tierLabel} pricingMode={pricingCtx.pricingMode} />
        </div>
        <PriceBreakdown breakdown={breakdown} variant="checkout-review" format={format} />
        {(depositPct > 0 || paymentTerms) && (
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            {paymentTerms && (
              <p>
                Payment terms:{' '}
                <span className="font-medium text-gray-700">{paymentTerms}</span>
              </p>
            )}
            {depositPct > 0 && (
              <p>
                Expected deposit ({depositPct}%):{' '}
                <span className="font-medium text-gray-900 tabular-nums">
                  {format(depositAmount)}
                </span>
              </p>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/checkout')}
          className="rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          Back to edit
        </button>
        <button
          type="button"
          onClick={confirmOrder}
          disabled={submitting || !customerCode}
          className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Placing order...' : 'Confirm & place order'}
        </button>
      </div>
        </div>
      </div>
    </div>
  )
}
