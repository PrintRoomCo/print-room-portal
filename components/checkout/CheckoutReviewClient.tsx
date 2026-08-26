'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { useCartLineFrontImages } from '@/components/cart/useCartLineFrontImages'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { CheckoutCTAStickyBar } from './CheckoutCTAStickyBar'
import { CheckoutPlacingOverlay } from './CheckoutPlacingOverlay'
import { CustomerCodeNotice } from './CustomerCodeNotice'
import {
  billedOrderShape,
  checkoutBillingShape,
  checkoutOrderGroupFromPrepared,
  type BilledLine,
} from '@/lib/pricing/order-billing-shape'
import { useFreshBillingModes } from './useFreshBillingModes'
import {
  BilledOrderSummary,
  CountryBilledOrderSummary,
  type CheckoutCountryFailure,
} from './BilledOrderSummary'
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
  writeCheckoutReviewState,
  type CheckoutReviewState,
  type StoredPartitionOutcome,
} from './checkoutReviewState'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'
import { TERMS_VERSION } from '@/lib/checkout/terms'
import { TermsModal } from './TermsModal'
import { SameArtworkSavings } from '@/components/pricing/SameArtworkSavings'
import { formatCurrency } from '@/lib/currency/format'
import {
  buildCheckoutRequestLines,
  useCheckoutPreview,
  withReviewedPartitionPrices,
} from './useCheckoutPreview'

interface CheckoutReviewClientProps {
  stores: StoreOption[]
  customerCode: string | null
  paymentTerms: string | null
  defaultDepositPercent: number | null
  /** organizations.is_test: when true, hide the deposit/payment-terms block (demo org). */
  isTest: boolean
  /** Buyer role: a branch manager is a 'staff' member with ≥1 grant. */
  role?: 'org_admin' | 'staff'
  /** Location-manager allow-list (raw grants). ≥1 ⇒ show the order-level branch picker. */
  branchStoreIds?: string[]
  /** The member's home store, always an allowed branch (union at read). */
  defaultStoreId?: string | null
  /** Default list currency, used only to label legacy persisted cart prices. */
  defaultPriceCurrency?: string | null
  /** Server-evaluated SP3 flag. Client components never read process.env. */
  countryPartitionEnabled?: boolean
}

interface CheckoutResponse {
  order_id: string
  order_ref: string
}

interface CheckoutPartitionResponse {
  outcomes: Array<
    | {
        ok: true
        partitionKey: string
        orderId: string
        orderRef: string
      }
    | {
        ok: false
        partitionKey: string
        code: string
        error: string
      }
  >
}

export function CheckoutReviewClient({
  stores,
  customerCode,
  paymentTerms,
  defaultDepositPercent,
  isTest,
  role,
  branchStoreIds = [],
  defaultStoreId = null,
  defaultPriceCurrency = null,
  countryPartitionEnabled = false,
}: CheckoutReviewClientProps) {
  const cart = useCart()
  const router = useRouter()
  const currencyContext = useCurrency()
  const { format } = currencyContext
  const { access, defaultBillingCountry } = useCompany()
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
  // T&C consent + honeypot: ephemeral, NOT persisted to reviewState. The box
  // resets to unticked on every reload so each checkout is a fresh affirmation
  // (design 2026-08-11, Decision 6).
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [focusPartitionKey, setFocusPartitionKey] = useState<string | null>(null)
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
          // FRESH mode only, never the cart's PDP-time snapshot.
          billingMode: modeByVariantId[line.variantId] ?? null,
        })),
        gstRate: defaultBillingCountry.taxRate,
        // Task 7's private flag-off adapter owns the frozen legacy estimate.
        // Enabled checkout money comes only from prepared country partitions.
        shipCountry: 'NZ',
        defaultBillCountry: defaultBillingCountry.code,
      }),
    [
      cart.lines,
      modeByVariantId,
      defaultBillingCountry.code,
      defaultBillingCountry.taxRate,
    ],
  )

  const lineById = useMemo(
    () => new Map(cart.lines.map((line) => [line.lineId, line])),
    [cart.lines],
  )
  const depositPct = defaultDepositPercent ?? 0
  // Off the BILLED subtotal, never charge a deposit on prepaid stock.
  const depositAmount = (shape.billedSubtotal * depositPct) / 100

  const allCustom =
    reviewState != null && allLinesUseCustomAddress(cart.lines, reviewState.perLineShipTo)

  const checkoutLines = useMemo(
    () =>
      reviewState
        ? buildCheckoutRequestLines({
            lines: cart.lines,
            perLineShipTo: reviewState.perLineShipTo,
            allCustom,
            modeByVariantId,
            defaultPriceCurrency: countryPartitionEnabled
              ? defaultPriceCurrency ?? undefined
              : undefined,
          })
        : [],
    [
      reviewState,
      cart.lines,
      allCustom,
      modeByVariantId,
      countryPartitionEnabled,
      defaultPriceCurrency,
    ],
  )
  const previewRequest = useMemo(
    () =>
      countryPartitionEnabled && reviewState && pricingReady
        ? {
            idempotency_key: reviewState.idempotencyKey,
            required_by: reviewState.requiredBy || null,
            notes: reviewState.notes || null,
            intent: reviewState.intent,
            lines: checkoutLines,
            custom_shipping_address: allCustom ? reviewState.customAddress : null,
          }
        : null,
    [countryPartitionEnabled, reviewState, pricingReady, checkoutLines, allCustom],
  )
  const preview = useCheckoutPreview(countryPartitionEnabled, previewRequest)
  const previewSuccesses = preview.partitions.filter((outcome) => outcome.ok)
  const previewFailures: CheckoutCountryFailure[] = preview.partitions
    .filter((outcome) => !outcome.ok)
    .map((outcome) => ({
      partitionKey: outcome.partitionKey,
      countryCode: outcome.countryCode,
      countryName: outcome.country.name,
      currency: outcome.country.currency,
      code: outcome.code,
      error: outcome.error,
    }))
  const countryShape = checkoutBillingShape(
    previewSuccesses.map((outcome) => checkoutOrderGroupFromPrepared(outcome.partition)),
  )
  const partitionOutcomes = useMemo(
    () => reviewState?.partitionOutcomes ?? {},
    [reviewState?.partitionOutcomes],
  )
  const failedPartitionKeys = Object.values(partitionOutcomes)
    .filter((outcome) => !outcome.ok)
    .map((outcome) => outcome.partitionKey)
  const failedPartitionCount = failedPartitionKeys.length
  const retryShape = checkoutBillingShape(
    previewSuccesses
      .filter((outcome) => failedPartitionKeys.includes(outcome.partition.key))
      .map((outcome) => checkoutOrderGroupFromPrepared(outcome.partition)),
  )

  useEffect(() => {
    if (!focusPartitionKey) return
    const target = Array.from(
      document.querySelectorAll<HTMLElement>('[data-partition-error]'),
    ).find((element) => element.dataset.partitionError === focusPartitionKey)
    if (target) {
      target.focus()
    }
  }, [focusPartitionKey, partitionOutcomes])

  // Location-manager: a staff member with ≥1 grant may order for any branch they
  // manage. The order stays ONE destination (submit guard enforces it), so the
  // picker is order-level and applies the chosen branch to every line.
  const isManager = role === 'staff' && branchStoreIds.length > 0
  const managerBranchOptions = useMemo(() => {
    if (!isManager) return []
    return resolveBranchStoreIds(branchStoreIds, defaultStoreId).map((id) => ({
      id,
      label: storeById.get(id)?.name ?? 'Store',
    }))
  }, [isManager, branchStoreIds, defaultStoreId, storeById])
  const selectedBranchId =
    (reviewState && cart.lines[0]
      ? reviewState.perLineShipTo[cart.lines[0].lineId] ?? null
      : null) ?? defaultStoreId

  function setOrderBranch(storeId: string) {
    setReviewState((prev) => {
      if (!prev) return prev
      const perLineShipTo: Record<string, string | null> = { ...prev.perLineShipTo }
      for (const line of cart.lines) perLineShipTo[line.lineId] = storeId
      const next = { ...prev, perLineShipTo }
      writeCheckoutReviewState(next)
      return next
    })
  }

  async function confirmOrder() {
    if (inFlightRef.current) return // re-entry guard: one submit in flight at a time
    if (isPreview) return // read-only preview, never POST
    if (!reviewState || cart.lines.length === 0) return

    // Client-only honeypot (design 2026-08-11, Decision 5): a real user can
    // never see or focus this off-screen field. If it is non-empty it was
    // autofilled/scripted: abort silently, no banner, no POST. NEVER sent to
    // the server; the auth gate is the real anti-bot control.
    if (honeypot !== '') return

    // Terms gate (Decision 8): a *validation* concern like missingShipTo below:
    // the button stays enabled and we guard here so the message is announced.
    if (!termsAccepted) {
      setBanner({
        kind: 'error',
        msg: 'Please read and agree to the Terms & Conditions before placing your order.',
      })
      return
    }

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
          lines: countryPartitionEnabled
            ? withReviewedPartitionPrices(checkoutLines, preview.partitions)
            : cart.lines.map((line) => ({
            product_id: line.productId,
            product_name: line.productName,
            variant_id: line.variantId || null,
            size_id: line.sizeId ?? null,
            size_label: line.sizeLabel ?? null,
            qty: line.qty,
            ship_to_store_id: allCustom ? null : reviewState.perLineShipTo[line.lineId] ?? null,
            // Feature 1: carry the chosen PDP location label so the server can
            // snapshot it onto quote_items.line_location_label.
            location_label: line.locationLabel ?? null,
            // Feature 2: snapshot the optional custom name onto quote_items.line_custom_name.
            custom_name: line.customName ?? null,
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
            // Null for a variantless line, nothing to claim.
            claimed_billing_mode: line.variantId
              ? modeByVariantId[line.variantId] ?? 'invoice_on_dispatch'
              : null,
              })),
          // Consent for this order (design 2026-08-11). The server re-validates
          // and 400s without these; the checkbox is not the only gate.
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          custom_shipping_address: allCustom ? reviewState.customAddress : null,
        }),
      })

      if (countryPartitionEnabled && res.ok) {
        const result = (await res.json()) as CheckoutPartitionResponse
        if (!Array.isArray(result.outcomes) || result.outcomes.length === 0) {
          throw new Error('No country order outcomes were returned.')
        }
        const nextPartitionOutcomes: Record<string, StoredPartitionOutcome> = {
          ...partitionOutcomes,
        }
        for (const outcome of result.outcomes) {
          nextPartitionOutcomes[outcome.partitionKey] = outcome.ok
            ? {
                ok: true,
                partitionKey: outcome.partitionKey,
                orderId: outcome.orderId,
                orderRef: outcome.orderRef,
              }
            : {
                ok: false,
                partitionKey: outcome.partitionKey,
                code: outcome.code,
                error: outcome.error,
              }
        }
        const nextReviewState = {
          ...reviewState,
          partitionOutcomes: nextPartitionOutcomes,
        }
        writeCheckoutReviewState(nextReviewState)
        setReviewState(nextReviewState)

        const expectedPartitionKeys = previewSuccesses.map(
          (outcome) => outcome.partition.key,
        )
        const missingPartitionKey = expectedPartitionKeys.find(
          (partitionKey) => !nextPartitionOutcomes[partitionKey],
        )
        if (missingPartitionKey) {
          throw new Error(
            `No placement outcome was returned for ${missingPartitionKey}.`,
          )
        }
        const failed = expectedPartitionKeys
          .map((partitionKey) => nextPartitionOutcomes[partitionKey])
          .filter(
            (outcome): outcome is Extract<StoredPartitionOutcome, { ok: false }> =>
              !outcome.ok,
          )
        if (failed.length > 0) {
          setFocusPartitionKey(failed[0].partitionKey)
          return
        }

        const primary = nextPartitionOutcomes[expectedPartitionKeys[0]]
        if (!primary?.ok) {
          throw new Error('No placed order was returned.')
        }
        clearCheckoutReviewState()
        navigating = true
        router.push(`/checkout/confirmation/${primary.orderId}`)
        cart.clear()
        return
      }

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
            msg: 'Pre-paid status changed. Review your cart.',
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
      // navigate first, then clear the cart; the overlay masks the emptied
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

  function renderReviewLine(billedLine: BilledLine, currency?: string) {
    const line = lineById.get(billedLine.lineId)
    if (!line) return null
    const imageUrl = cartLineDisplayImageUrl(line, {
      catalogueFrontImageUrl: frontImageByLineId[line.lineId] ?? null,
    })
    const visibleDecorations = line.decorations.filter(
      (decoration) => !isGenericCustomDecorationName(decoration.name),
    )
    const lineFormat = currency
      ? (amount: number) => `${formatCurrency(amount, currency)} ${currency}`
      : format
    const oemPresentation = countryPartitionEnabled
    return (
      <article>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className={`relative h-24 w-24 shrink-0 overflow-hidden ${
              oemPresentation ? 'rounded-2xl bg-black/[0.03]' : 'rounded-lg bg-gray-50'
            }`}>
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt=""
                  fill
                  sizes="96px"
                  className="object-contain p-1"
                  unoptimized
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className={`text-base font-medium ${oemPresentation ? 'text-black' : 'text-gray-900'}`}>
                {line.productName}
              </h3>
              {!billedLine.billed && <PrepaidBadge />}
              <p className={`mt-1 text-xs tracking-wide ${oemPresentation ? 'text-black/55' : 'text-gray-500'}`}>
                {line.variantLabel}
              </p>
              {visibleDecorations.length > 0 && (
                <ul className={`mt-2 space-y-1 text-xs ${oemPresentation ? 'text-black/60' : 'text-gray-600'}`}>
                  {visibleDecorations.map((decoration) => (
                    <li key={decoration.linkId}>{decoration.name}</li>
                  ))}
                </ul>
              )}
              <SameArtworkSavings line={line} />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-xs ${oemPresentation ? 'text-black/55' : 'text-gray-500'}`}>
              <span className={`tabular-nums ${oemPresentation ? 'text-black/60' : 'text-gray-600'}`}>
                {lineFormat(
                  currency
                    ? billedLine.unitPrice + billedLine.decorationPerUnit
                    : allInUnitPrice(line),
                )}
              </span>
              <span aria-hidden="true" className={`px-1.5 ${oemPresentation ? 'text-black/30' : 'text-gray-300'}`}>×</span>
              <span className={`tabular-nums ${oemPresentation ? 'text-black/60' : 'text-gray-600'}`}>
                {line.qty}
              </span>
            </div>
            <div className="mt-2 text-base">
              <PrepaidLinePrice
                goodsValue={billedLine.goodsValue}
                billed={billedLine.billed}
                format={lineFormat}
                oemPresentation={oemPresentation}
              />
            </div>
          </div>
        </div>
      </article>
    )
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

      {!customerCode && <CustomerCodeNotice />}

      <section className="rounded-[32px] bg-white p-7 md:p-8">
        {countryPartitionEnabled ? (
          preview.status === 'ready' ? (
            <CountryBilledOrderSummary
              shape={countryShape}
              failures={previewFailures}
              partitionOutcomes={partitionOutcomes}
              renderLine={renderReviewLine}
            />
          ) : (
            <div>
              <div
                role={preview.status === 'error' ? 'alert' : 'status'}
                className={
                  preview.status === 'error'
                    ? 'mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800'
                    : 'mb-5 rounded-2xl bg-black/[0.03] p-4 text-sm text-black/65'
                }
              >
                {preview.status === 'error'
                  ? preview.error
                  : 'Updating country prices…'}
              </div>
              <div className="space-y-6">
                {shape.partitions.flatMap((partition) => partition.lines).map((line) => (
                  <div key={line.lineId}>{renderReviewLine(line)}</div>
                ))}
              </div>
            </div>
          )
        ) : (
          <BilledOrderSummary
            shape={shape}
            format={format}
            defaultBreakdownOpen
            renderLine={renderReviewLine}
          />
        )}

        {!isTest && (depositPct > 0 || paymentTerms) && (
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            {paymentTerms && (
              <p>
                Payment terms:{' '}
                <span className="font-medium text-gray-700">{paymentTerms}</span>
              </p>
            )}
            {depositPct > 0 && countryPartitionEnabled && (
              <p>Expected deposit ({depositPct}%) will be invoiced per order.</p>
            )}
            {depositPct > 0 && !countryPartitionEnabled && (
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
            <>
              {isManager && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-500">
                    <label htmlFor="ordering-for-branch">Ordering for branch</label>
                  </dt>
                  <dd className="text-right">
                    <select
                      id="ordering-for-branch"
                      value={selectedBranchId ?? ''}
                      onChange={(e) => setOrderBranch(e.target.value)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-black/40"
                    >
                      {managerBranchOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
              )}
              {cart.lines.map((line) => {
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
              })}
            </>
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

      <section className="mt-6">
          {/*
            Client-only honeypot (design 2026-08-11, Decision 5). Deliberately
            NOT Tailwind `sr-only`, which EXPOSES the field to screen readers,
            the one false-positive path where a real assistive-tech user could
            fill it. Off-screen + aria-hidden + tabIndex=-1 keeps it out of both
            the visual and the accessibility tree. autoComplete="off" + an
            autofill-resistant name avoid browser autofill tripping it.
          */}
          <input
            type="text"
            name="company_url"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
          <label htmlFor="terms-agree" className="flex items-start gap-2 text-sm text-gray-700">
            <input
              id="terms-agree"
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-pr-blue focus:ring-pr-blue/40"
            />
            <span>
              I have read and agree to the{' '}
              <button
                type="button"
                onClick={(e) => {
                  // Stop the label from forwarding the click to the checkbox;
                  // opening the terms must not tick the box.
                  e.preventDefault()
                  e.stopPropagation()
                  setTermsOpen(true)
                }}
                className="font-medium text-pr-blue underline underline-offset-2 hover:text-pr-blue/80"
              >
                Terms &amp; Conditions
              </button>
            </span>
          </label>
      </section>
        </div>
      </div>

      {termsOpen && (
        <TermsModal
          currency={defaultBillingCountry.currency}
          taxLabel={defaultBillingCountry.taxLabel}
          onClose={() => setTermsOpen(false)}
        />
      )}

      <CheckoutCTAStickyBar
        itemCount={cart.lines.length}
        orderCount={
          countryPartitionEnabled
            ? failedPartitionCount || Math.max(1, preview.partitions.length)
            : shape.invoiceCount
        }
        totalsByCurrency={
          countryPartitionEnabled
            ? preview.status === 'ready'
              ? failedPartitionCount > 0
                ? retryShape.totalsByCurrency
                : preview.totalsByCurrency
              : []
            : [{
                currency: currencyContext.currency ?? defaultBillingCountry.currency,
                total: currencyContext.convert?.(shape.grandTotal) ?? shape.grandTotal,
              }]
        }
        onSubmit={confirmOrder}
        // Unlike /checkout, this button PLACES the order; it must never fire
        // against a total the fresh billing read hasn't resolved yet.
        disabled={
          !pricingReady ||
          isPreview ||
          !customerCode ||
          (countryPartitionEnabled &&
            (preview.status !== 'ready' ||
              preview.partitions.length === 0 ||
              previewFailures.length > 0))
        }
        submitting={submitting}
        action={
          isPreview
            ? 'preview'
            : countryPartitionEnabled && failedPartitionCount > 0
              ? 'retry'
              : 'place'
        }
        submittingLabel="Placing order…"
        legacyPresentation={
          countryPartitionEnabled
            ? undefined
            : {
                totalLabel: format(shape.grandTotal),
                actionLabel: 'Confirm & place order',
              }
        }
      />
    </div>
  )
}
