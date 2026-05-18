'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { ShipToRow, type StoreOption } from './ShipToRow'
import {
  EMPTY_CUSTOM_ADDRESS,
  writeCheckoutReviewState,
  type CustomAddress,
} from './checkoutReviewState'
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { decorationPerUnit } from '@/lib/cart/types'
import { useCurrency } from '@/contexts/CurrencyContext'
import { splitCartByIntent } from '@/lib/checkout/split-cart-by-intent'
import { useCartDrawer } from '@/components/layout/PortalTopBarContext'

interface CheckoutClientProps {
  stores: StoreOption[]
  customerCode: string | null
  paymentTerms: string | null
  defaultDepositPercent: number | null
  /**
   * Per-buyer default ship-to. When set AND the store is in `stores`, every
   * line is locked to it (staff intent: this buyer always ships to this store).
   * When null, the parent falls back to `stores[0]` so the dropdown is still
   * pre-populated but editable.
   */
  defaultStoreId: string | null
  /**
   * Buyer Roles step 6 — when true, ship-to is hard-locked to defaultStoreId
   * and the custom-address path is hidden. The DB CHECK guarantees defaultStoreId
   * is set for buyers, but we defend against drift by surfacing a banner.
   */
  isBuyer: boolean
  /**
   * Kept on the prop signature for parent compatibility, but no longer used:
   * the old order-level "Add to inventory" admin toggle has been retired in
   * favour of per-line `routeToInventory` flags (set on the PDP and bulk-
   * editable from the cart drawer). The downstream submit pipeline reads the
   * per-line flag instead of an order-level intent.
   */
  tenantType?: 'franchise' | 'studio_plus_inventory' | 'studio' | null
}

export function CheckoutClient({
  stores,
  customerCode,
  paymentTerms,
  defaultDepositPercent,
  defaultStoreId: buyerDefaultStoreId,
  isBuyer,
}: CheckoutClientProps) {
  const cart = useCart()
  const router = useRouter()
  const { format } = useCurrency()
  const cartDrawer = useCartDrawer()

  const idempotencyKey = useRef<string>(crypto.randomUUID())

  const buyerDefaultIsAvailable =
    buyerDefaultStoreId != null && stores.some((s) => s.id === buyerDefaultStoreId)
  const initialStoreId = buyerDefaultIsAvailable
    ? buyerDefaultStoreId
    : stores[0]?.id ?? null
  // Buyers: hard lock regardless of `buyerDefaultIsAvailable` (CHECK enforces it,
  // but we'd rather fail loud via the banner below if drift occurs).
  const lockToBuyerDefault = isBuyer || buyerDefaultIsAvailable
  const buyerMisconfigured = isBuyer && !buyerDefaultIsAvailable
  const [perLineShipTo, setPerLineShipTo] = useState<Record<string, string | null>>(() => {
    const m: Record<string, string | null> = {}
    for (const l of cart.lines) m[l.lineId] = initialStoreId
    return m
  })

  const [customAddress, setCustomAddress] = useState<CustomAddress>(EMPTY_CUSTOM_ADDRESS)
  const [requiredBy, setRequiredBy] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [submitting, setSubmitting] = useState<false | 'review'>(false)
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)

  // Mixed-intent split preview. Source of truth for the inventory routing
  // decision is now the per-line `routeToInventory` flag on each cart line
  // (set on the PDP, bulk-editable from the cart drawer). The pure helper
  // `splitCartByIntent` partitions lines into customer-ship and inventory
  // buckets; we render the appropriate banner based on which buckets are
  // non-empty. The helper only reads `route_to_inventory`, so a minimal
  // adapter shape is sufficient.
  const { customer: customerLines, inventory: inventoryLines } = useMemo(
    () =>
      splitCartByIntent({
        lines: cart.lines.map((l) => ({
          route_to_inventory: l.routeToInventory === true,
        })),
        fastPathEntireOrderToInventory: false,
      }),
    [cart.lines],
  )
  const customerLineCount = customerLines.length
  const inventoryLineCount = inventoryLines.length
  const customerUnitCount = useMemo(
    () =>
      cart.lines.reduce(
        (sum, l) => sum + (l.routeToInventory === true ? 0 : l.qty),
        0,
      ),
    [cart.lines],
  )
  const inventoryUnitCount = useMemo(
    () =>
      cart.lines.reduce(
        (sum, l) => sum + (l.routeToInventory === true ? l.qty : 0),
        0,
      ),
    [cart.lines],
  )
  const isMixedIntent = customerLineCount > 0 && inventoryLineCount > 0
  const isInventoryOnly = customerLineCount === 0 && inventoryLineCount > 0
  // Routing is now per-line (`CartLine.routeToInventory`) — there's no order-
  // level `intent` to persist. The submit pipeline derives the intent from the
  // bucket split on the server side (cluster 2.10).

  useEffect(() => {
    setPerLineShipTo((prev) => {
      let changed = false
      const next: Record<string, string | null> = {}
      for (const line of cart.lines) {
        if (Object.prototype.hasOwnProperty.call(prev, line.lineId)) {
          next[line.lineId] = prev[line.lineId]
        } else {
          next[line.lineId] = initialStoreId
          changed = true
        }
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true
      return changed ? next : prev
    })
  }, [cart.lines, initialStoreId])

  const anyCustom = Object.values(perLineShipTo).some((v) => v === null)
  const allCustom = Object.values(perLineShipTo).every((v) => v === null)
  const mixedCustom = anyCustom && !allCustom
  const customAddressErrors = {
    address: allCustom && !customAddress.address ? 'Street address is required.' : null,
    city: allCustom && !customAddress.city ? 'City is required.' : null,
    country: allCustom && !customAddress.country ? 'Country is required.' : null,
  }
  const customIncomplete = Object.values(customAddressErrors).some(Boolean)

  const pricingCtx = usePricingContext()
  const breakdown = useMemo(
    () =>
      computeOrderBreakdown({
        lines: cart.lines.map((l) => ({
          qty: l.qty,
          unitEffective: l.unitPrice,
          decorationPerUnit: decorationPerUnit(l),
        })),
        gstRate: 0.15,
      }),
    [cart.lines]
  )
  const depositPct = defaultDepositPercent ?? 0
  const depositAmount = (breakdown.netSubtotal * depositPct) / 100

  const customerCodeMissing = !customerCode
  const canSubmitOrder =
    !submitting &&
    cart.lines.length > 0 &&
    !customerCodeMissing &&
    !mixedCustom &&
    !customIncomplete &&
    !buyerMisconfigured

  function proceedToReview() {
    if (!canSubmitOrder) return
    setSubmitting('review')
    setBanner(null)
    try {
      writeCheckoutReviewState({
        idempotencyKey: idempotencyKey.current,
        requiredBy,
        notes,
        perLineShipTo,
        customAddress,
        createdAt: new Date().toISOString(),
      })
      router.push('/checkout/review')
    } catch (e) {
      setBanner({
        kind: 'error',
        msg:
          (e as Error).message ||
          'Could not prepare the review step. Please try again.',
      })
      setSubmitting(false)
    }
  }

  if (cart.lines.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
          <header className="mb-10 md:mb-12">
            <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
              Checkout
            </h1>
            <p className="mt-3 text-sm text-gray-600">
              Confirm shipping and submit against your account terms.
            </p>
          </header>
          <PortalEmptyState
            title="Checkout is ready when your cart is"
            body="Add products from your catalogue, then return here to confirm shipping and submit the order."
            actionHref="/catalogue"
            actionLabel="Browse catalogue"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Checkout
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            Confirm shipping and submit against your account terms.
          </p>
        </header>

        <div className="space-y-6">
      {banner && (
        <div
          className={`mb-4 rounded-xl border p-4 text-sm ${
            banner.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-sky-200 bg-sky-50 text-sky-900'
          }`}
        >
          {banner.msg}
        </div>
      )}

      {customerCodeMissing && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Your account is pending setup — contact staff to assign your customer code before
          submitting an order.
        </div>
      )}

      {buyerMisconfigured && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Your default shipping store is missing or no longer assigned to your account — please
          contact staff before submitting an order.
        </div>
      )}

      {depositPct > 0 && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          A deposit of {depositPct}% ({format(depositAmount)}) will be
          invoiced up-front. Balance on {paymentTerms ?? 'net20'}.
        </div>
      )}

      {isMixedIntent && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            <span className="font-medium">This order will split into two.</span>{' '}
            {customerUnitCount} units shipping to your customer + {inventoryUnitCount} units added
            to your inventory shelf. Each part is priced as its own production run, so your
            per-unit cost may differ from a single-intent order.
          </p>
          <p className="mt-2">
            <button
              type="button"
              onClick={() => cartDrawer.setOpen(true)}
              className="font-medium underline underline-offset-2 hover:text-amber-950"
            >
              Edit destinations
            </button>
          </p>
        </div>
      )}

      {isInventoryOnly && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span className="font-medium">Routing to your inventory shelf.</span> Every line in this
          order is flagged for inventory — your account manager will mark each variant received
          when stock lands.{' '}
          <button
            type="button"
            onClick={() => cartDrawer.setOpen(true)}
            className="font-medium underline underline-offset-2 hover:text-amber-950"
          >
            Edit destinations
          </button>
        </div>
      )}

      <section className="rounded-[32px] bg-white p-7 md:p-8">
        <h2 className="text-sm font-medium text-gray-700">Shipping — per line</h2>
        <div className="mt-3 space-y-2">
          {cart.lines.map((line) => (
            <ShipToRow
              key={line.lineId}
              line={line}
              stores={stores}
              value={perLineShipTo[line.lineId] ?? null}
              onChange={(next) =>
                setPerLineShipTo((prev) => ({ ...prev, [line.lineId]: next }))
              }
              disabled={submitting !== false || lockToBuyerDefault}
              allowCustom={!isBuyer}
            />
          ))}
        </div>
      </section>

      {mixedCustom && (
        <p className="mt-3 text-sm text-red-600">
          Custom addresses can't be mixed with store ship-tos in v1. Either pick a store
          for every line, or select "Custom address…" on every line and fill in one
          shared address below.
        </p>
      )}

      {allCustom && (
        <section className="mt-4 rounded-[32px] bg-white p-7 md:p-8">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Custom shipping address</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              id="custom-shipping-name"
              placeholder="Recipient name"
              value={customAddress.name}
              onChange={(e) => setCustomAddress({ ...customAddress, name: e.target.value })}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <div>
              <input
                id="custom-shipping-address"
                placeholder="Street address"
                value={customAddress.address}
                onChange={(e) => setCustomAddress({ ...customAddress, address: e.target.value })}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                aria-invalid={customAddressErrors.address ? true : undefined}
                aria-describedby={
                  customAddressErrors.address ? 'custom-shipping-address-error' : undefined
                }
              />
              {customAddressErrors.address && (
                <p
                  id="custom-shipping-address-error"
                  role="alert"
                  className="mt-1 text-xs text-red-600"
                >
                  {customAddressErrors.address}
                </p>
              )}
            </div>
            <div>
              <input
                id="custom-shipping-city"
                placeholder="City"
                value={customAddress.city}
                onChange={(e) => setCustomAddress({ ...customAddress, city: e.target.value })}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                aria-invalid={customAddressErrors.city ? true : undefined}
                aria-describedby={
                  customAddressErrors.city ? 'custom-shipping-city-error' : undefined
                }
              />
              {customAddressErrors.city && (
                <p
                  id="custom-shipping-city-error"
                  role="alert"
                  className="mt-1 text-xs text-red-600"
                >
                  {customAddressErrors.city}
                </p>
              )}
            </div>
            <input
              id="custom-shipping-postal-code"
              placeholder="Postal code"
              value={customAddress.postal_code}
              onChange={(e) =>
                setCustomAddress({ ...customAddress, postal_code: e.target.value })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <div>
              <input
                id="custom-shipping-country"
                placeholder="Country"
                value={customAddress.country}
                onChange={(e) =>
                  setCustomAddress({ ...customAddress, country: e.target.value })
                }
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                aria-invalid={customAddressErrors.country ? true : undefined}
                aria-describedby={
                  customAddressErrors.country ? 'custom-shipping-country-error' : undefined
                }
              />
              {customAddressErrors.country && (
                <p
                  id="custom-shipping-country-error"
                  role="alert"
                  className="mt-1 text-xs text-red-600"
                >
                  {customAddressErrors.country}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 rounded-[32px] bg-white p-7 md:grid-cols-2 md:p-8">
        <div>
          <label htmlFor="required-by" className="block text-sm font-medium text-gray-700">
            Required by (optional)
          </label>
          <input
            id="required-by"
            type="date"
            value={requiredBy}
            onChange={(e) => setRequiredBy(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
      </section>

      <section className="mt-6 rounded-[32px] bg-white p-7 md:p-8">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-gray-700">Pricing for</span>
          <TierBadge label={pricingCtx.tierLabel} pricingMode={pricingCtx.pricingMode} />
        </div>
        <PriceBreakdown breakdown={breakdown} variant="checkout-review" format={format} />
      </section>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={proceedToReview}
          disabled={!canSubmitOrder}
          className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === 'review' ? 'Preparing review…' : 'Review order'}
        </button>
      </div>
        </div>
      </div>
    </div>
  )
}
