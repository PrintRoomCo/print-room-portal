'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
import { CheckoutCTAStickyBar } from './CheckoutCTAStickyBar'
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { decorationPerUnit } from '@/lib/cart/types'
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
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: reviewState.idempotencyKey,
          required_by: reviewState.requiredBy || null,
          notes: reviewState.notes || null,
          intent: reviewState.intent,
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
            fulfilment_type: line.fulfilmentType,
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
        <div className="mx-auto max-w-[1320px] px-4 pb-[120px] pt-[100px] md:px-6 md:pb-[96px] md:pt-[120px]">
          <header className="mb-10 md:mb-12">
            <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
              Review order
            </h1>
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
        <div className="mx-auto max-w-[1320px] px-4 pb-[120px] pt-[100px] md:px-6 md:pb-[96px] md:pt-[120px]">
          <header className="mb-10 md:mb-12">
            <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
              Review order
            </h1>
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
        <div className="mx-auto max-w-[1320px] px-4 pb-[120px] pt-[100px] md:px-6 md:pb-[96px] md:pt-[120px]">
          <div className="rounded-[32px] bg-white p-7 text-sm text-gray-600 md:p-8">
            Loading review...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-[120px] pt-[100px] md:px-6 md:pb-[96px] md:pt-[120px]">
        <button
          type="button"
          onClick={() => router.push('/checkout')}
          className="mb-6 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <span aria-hidden="true">←</span>
          <span>Back to edit</span>
        </button>
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Review order
          </h1>
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
        <div className="mb-4 flex justify-end">
          <TierBadge label={pricingCtx.tierLabel} pricingMode={pricingCtx.pricingMode} />
        </div>
        <div className="divide-y divide-gray-100">
          {cart.lines.map((line) => {
            const lineTotal = line.qty * (line.unitPrice + decorationPerUnit(line))
            return (
              <article key={line.lineId} className="py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-50">
                      {line.imageUrl ? (
                        <Image
                          src={line.imageUrl}
                          alt=""
                          fill
                          sizes="80px"
                          className="object-contain p-1"
                          unoptimized
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-medium text-gray-900">{line.productName}</h3>
                      <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                        {line.variantLabel}
                      </p>
                      <p className="text-xs text-gray-500">qty {line.qty}</p>
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
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-gray-500">Unit {format(line.unitPrice)}</p>
                    <p className="mt-1 font-semibold text-gray-900">{format(lineTotal)}</p>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <div className="mt-6 flex items-baseline justify-between border-t border-gray-200 pt-5">
          <span className="text-base font-medium text-gray-900">Total</span>
          <span className="text-xl font-medium text-gray-900">{format(breakdown.total)}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">incl. GST · billed per account terms</p>

        <details open className="mt-3">
          <summary className="cursor-pointer select-none text-xs text-gray-500 hover:text-gray-700">
            Show breakdown
          </summary>
          <div className="mt-3">
            <PriceBreakdown breakdown={breakdown} variant="checkout-review" format={format} />
          </div>
        </details>

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

      <section className="mt-6">
        <h2 className="text-sm font-medium text-gray-700">Shipping and options</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Order routing</dt>
            <dd className="text-right text-gray-900">
              {reviewState.intent === 'inventory' ? 'Add to my inventory' : 'Ship to customer'}
            </dd>
          </div>
          {reviewState.intent === 'inventory' ? (
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Ship to</dt>
              <dd className="text-right text-gray-900">Print Room warehouse</dd>
            </div>
          ) : allCustom ? (
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
        </div>
      </div>

      <CheckoutCTAStickyBar
        itemCount={cart.lines.length}
        totalLabel={format(breakdown.total)}
        onSubmit={confirmOrder}
        disabled={!customerCode}
        submitting={submitting}
        submitLabel="Confirm & place order"
        submittingLabel="Placing order…"
      />
    </div>
  )
}
