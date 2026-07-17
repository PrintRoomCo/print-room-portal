'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { useCartLineFrontImages } from '@/components/cart/useCartLineFrontImages'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { CheckoutCTAStickyBar } from './CheckoutCTAStickyBar'
import { CheckoutPlacingOverlay } from './CheckoutPlacingOverlay'
import { billedOrderShape, type BilledLine } from '@/lib/pricing/order-billing-shape'
import { resolveShipCountry } from '@/lib/checkout/ship-country'
import { useFreshBillingModes } from './useFreshBillingModes'
import { BilledOrderSummary } from './BilledOrderSummary'
import { PrepaidBadge, PrepaidLinePrice } from './PrepaidLinePrice'
import {
  allInUnitPrice,
  cartLineDisplayImageUrl,
  decorationPerUnit,
  isGenericCustomDecorationName,
} from '@/lib/cart/types'
import { useCurrency } from '@/contexts/CurrencyContext'
import { useCompany } from '@/contexts/CompanyContext'
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
  /** organizations.is_test — when true, hide the deposit/payment-terms block (demo org). */
  isTest: boolean
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
  isTest,
}: CheckoutReviewClientProps) {
  const cart = useCart()
  const router = useRouter()
  const { format } = useCurrency()
  const { access } = useCompany()
  const isPreview = access?.isPreview ?? false
  const [reviewState, setReviewState] = useState<CheckoutReviewState | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Live re-entry guard. `submitting` state is stale inside a synchronous
  // double-fire, and the button's disabled state only kicks in after a
  // re-render, so a ref is the only thing that reliably blocks a second
  // in-flight submit.
  const inFlightRef = useRef(false)
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)
  const frontImageByLineId = useCartLineFrontImages(cart.lines)

  useEffect(() => {
    setReviewState(readCheckoutReviewState())
    setHydrated(true)
  }, [])

  const storeById = useMemo(() => {
    const map = new Map<string, StoreOption>()
    for (const store of stores) map.set(store.id, store)
    return map
  }, [stores])

  const shipCountry = useMemo<string | null>(() => {
    if (!reviewState) return null
    return resolveShipCountry({
      lines: cart.lines,
      perLineShipTo: reviewState.perLineShipTo,
      customAddressCountry: reviewState.customAddress.country,
      countryByStoreId: new Map(
        Array.from(storeById.entries()).map(([id, store]) => [id, store.country ?? null]),
      ),
    })
  }, [reviewState, cart.lines, storeById])

  const { modeByVariantId, status: billingStatus } = useFreshBillingModes(cart.lines)
  const pricingReady = billingStatus !== 'loading'

  const shape = useMemo(
    () =>
      billedOrderShape({
        lines: cart.lines.map((line) => ({
          lineId: line.lineId,
          qty: line.qty,
          unitPrice: line.unitPrice,
          decorationPerUnit: decorationPerUnit(line),
          fulfilmentType: line.fulfilmentType,
          // FRESH mode only — never the cart's PDP-time snapshot.
          billingMode: modeByVariantId[line.variantId] ?? null,
        })),
        gstRate: 0.15,
        shipCountry,
      }),
    [cart.lines, modeByVariantId, shipCountry],
  )

  const lineById = useMemo(
    () => new Map(cart.lines.map((line) => [line.lineId, line])),
    [cart.lines],
  )
  const depositPct = defaultDepositPercent ?? 0
  // Off the BILLED subtotal — never charge a deposit on prepaid stock.
  const depositAmount = (shape.billedSubtotal * depositPct) / 100

  const allCustom =
    reviewState != null && allLinesUseCustomAddress(cart.lines, reviewState.perLineShipTo)

  async function confirmOrder() {
    if (inFlightRef.current) return // re-entry guard: one submit in flight at a time
    if (isPreview) return // read-only preview — never POST
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
          msg: 'One-time shipping address is incomplete. Go back to checkout and fill in the required fields.',
        })
        return
      }
    }

    inFlightRef.current = true
    setSubmitting(true)
    setBanner(null)
    let navigating = false
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
            size_id: line.sizeId ?? null,
            size_label: line.sizeLabel ?? null,
            qty: line.qty,
            ship_to_store_id: allCustom ? null : reviewState.perLineShipTo[line.lineId] ?? null,
            cart_line_id: line.lineId,
            decorations: line.decorations,
            claimed_unit_price: line.unitPrice,
            has_brackets: Array.isArray(line.brackets) && line.brackets.length > 0,
            fulfilment_type: line.fulfilmentType,
            catalogueItemId: line.catalogueItemId ?? null,
            // Manual-final: the cart's claimed combined decoration figure for the
            // whole item. The server re-derives it from the engine and drift-checks.
            claimed_manual_decoration: line.manualDecorationPerUnit ?? null,
            // Drift guard (D4). The server re-resolves and 409s on ANY mismatch,
            // in both directions: even drift that favours the customer means the
            // page disagreed with the quote, which is the defect being fixed.
            // Null for a variantless line — nothing to claim.
            claimed_billing_mode: line.variantId
              ? modeByVariantId[line.variantId] ?? 'invoice_on_dispatch'
              : null,
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
          billingDrift?: Array<{
            cartLineId: string | null
            productId: string
            productName: string
            claimedBillingMode: string
            canonicalBillingMode: string
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
        if (data.error === 'member_access_drift') {
          setBanner({
            kind: 'error',
            msg:
              'Your catalogue access changed while this order was being reviewed. Return to the catalogue and add the available items again.',
          })
          return
        }
        if (data.error === 'buyer_ship_to_mismatch') {
          setBanner({
            kind: 'error',
            msg:
              'Your shipping location changed while this order was being reviewed. Go back to checkout and confirm the ship-to location.',
          })
          return
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
          return
        }
        if (data.error === 'decoration_price_drift' && data.drift) {
          const summary = data.drift
            .map((d) => `${d.decorationName} (${d.reason})`)
            .join('; ')
          setBanner({
            kind: 'error',
            msg: `Decoration pricing has changed - review your cart. ${summary}`,
          })
          return
        }
        if (data.error === 'billing_mode_drift') {
          setBanner({
            kind: 'error',
            msg: 'Pre-paid status changed — review your cart.',
          })
          return
        }
        if (data.error === 'unit_price_drift' && data.priceDrift) {
          const summary = data.priceDrift
            .map((d) => d.productName)
            .join('; ')
          setBanner({
            kind: 'error',
            msg: `Pricing has changed since you added these to your cart - review and resubmit. ${summary}`,
          })
          return
        }
        if (data.error === 'OUT_OF_STOCK') {
          setBanner({
            kind: 'error',
            msg:
              'Stock changed while you were checking out - please review your order and try again.',
          })
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
          return
        }
        setBanner({
          kind: 'error',
          msg: 'Stock changed while you were checking out - please review your cart and try again.',
        })
        return
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }

      const result = (await res.json()) as CheckoutResponse
      clearCheckoutReviewState()
      // Keep `submitting` true so the overlay stays up through the redirect;
      // navigate first, then clear the cart — the overlay masks the emptied
      // review page so it never flashes.
      navigating = true
      router.push(`/checkout/confirmation/${result.order_id}`)
      cart.clear()
    } catch (error) {
      setBanner({ kind: 'error', msg: (error as Error).message })
    } finally {
      // On success we deliberately keep the overlay up (we're leaving this page);
      // reset only on the failure / early-return paths.
      if (!navigating) {
        setSubmitting(false)
        inFlightRef.current = false
      }
    }
  }

  if (cart.lines.length === 0 && !submitting) {
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
      <CheckoutPlacingOverlay show={submitting} />
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
        <BilledOrderSummary
          shape={shape}
          format={format}
          defaultBreakdownOpen
          renderLine={(billedLine: BilledLine) => {
            const line = lineById.get(billedLine.lineId)
            if (!line) return null
            const imageUrl = cartLineDisplayImageUrl(line, {
              catalogueFrontImageUrl: frontImageByLineId[line.lineId] ?? null,
            })
            const visibleDecorations = line.decorations.filter(
              (decoration) => !isGenericCustomDecorationName(decoration.name),
            )
            return (
              <article className="py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-50">
                      {imageUrl ? (
                        <Image
                          src={imageUrl}
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
                      {/* From the billed shape, so the badge and the $0 are the
                          same decision — they cannot disagree. */}
                      {!billedLine.billed && <PrepaidBadge />}
                      <p className="mt-1 text-xs tracking-wide text-gray-500">
                        {line.variantLabel}
                      </p>
                      <p className="text-xs text-gray-500">qty {line.qty}</p>
                      {visibleDecorations.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-gray-600">
                          {visibleDecorations.map((decoration) => (
                            <li key={decoration.linkId}>
                              {decoration.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-gray-500">Unit {format(allInUnitPrice(line))}</p>
                    <div className="mt-1">
                      <PrepaidLinePrice
                        goodsValue={billedLine.goodsValue}
                        billed={billedLine.billed}
                        format={format}
                      />
                    </div>
                  </div>
                </div>
              </article>
            )
          }}
        />

        {!isTest && (depositPct > 0 || paymentTerms) && (
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
              <dt className="text-gray-500">One-time shipping address</dt>
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
        totalLabel={pricingReady ? format(shape.grandTotal) : '—'}
        onSubmit={confirmOrder}
        // Unlike /checkout, this button PLACES the order — it must never fire
        // against a total the fresh billing read hasn't resolved yet.
        disabled={!pricingReady || isPreview || !customerCode}
        submitting={submitting}
        submitLabel={isPreview ? 'Preview only' : 'Confirm & place order'}
        submittingLabel="Placing order…"
      />
    </div>
  )
}
