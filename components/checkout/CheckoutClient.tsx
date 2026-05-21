'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { ShipToRow, type StoreOption } from './ShipToRow'
import { AddAllToInventoryToggle } from './AddAllToInventoryToggle'
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
  /** Slice 4: gates the "Add to inventory" admin checkout toggle. */
  tenantType: 'franchise' | 'studio_plus_inventory' | 'studio' | null
}

export function CheckoutClient({
  stores,
  customerCode,
  paymentTerms,
  defaultDepositPercent,
  defaultStoreId: buyerDefaultStoreId,
  isBuyer,
  tenantType,
}: CheckoutClientProps) {
  const cart = useCart()
  const router = useRouter()
  const { format } = useCurrency()

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
  // Admin-only "send this batch to inventory instead of a customer address"
  // routing. Only meaningful for orgs that track stock; buyers never see the
  // toggles. Per-line ticks live in `inventoryByLine`; the order-level intent
  // is derived (all-on / all-off / mixed-blocker).
  const canRouteToInventory =
    !isBuyer && (tenantType === 'studio_plus_inventory' || tenantType === 'franchise')
  const hasMakeToStockLines = cart.lines.some((l) => l.fulfilmentType === 'make_to_stock')
  const [inventoryByLine, setInventoryByLine] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    if (canRouteToInventory) {
      // Auto-engage per make_to_stock line: qty exceeded available stock on
      // the PDP, so those lines must go to production → inventory shelf.
      for (const l of cart.lines) {
        m[l.lineId] = l.fulfilmentType === 'make_to_stock'
      }
    }
    return m
  })

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

  useEffect(() => {
    if (!canRouteToInventory) return
    setInventoryByLine((prev) => {
      let changed = false
      const next: Record<string, boolean> = {}
      for (const line of cart.lines) {
        const forced = line.fulfilmentType === 'make_to_stock'
        if (Object.prototype.hasOwnProperty.call(prev, line.lineId)) {
          // Keep prior choice unless the line is now forced-on.
          next[line.lineId] = forced ? true : prev[line.lineId]
          if (next[line.lineId] !== prev[line.lineId]) changed = true
        } else {
          next[line.lineId] = forced
          changed = true
        }
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true
      return changed ? next : prev
    })
  }, [cart.lines, canRouteToInventory])

  const inventoryFlags = cart.lines.map((l) => inventoryByLine[l.lineId] ?? false)
  const allInventory =
    canRouteToInventory && inventoryFlags.length > 0 && inventoryFlags.every(Boolean)
  const noneInventory = !canRouteToInventory || inventoryFlags.every((v) => !v)
  const mixedInventory = canRouteToInventory && !allInventory && !noneInventory
  const intent: 'customer' | 'inventory' | null = mixedInventory
    ? null
    : allInventory
      ? 'inventory'
      : 'customer'
  const inventoryMode = intent === 'inventory'

  function setAllInventory(next: boolean) {
    setInventoryByLine((prev) => {
      const updated: Record<string, boolean> = {}
      for (const line of cart.lines) {
        // make-to-stock lines stay forced ON even when master toggle is off.
        updated[line.lineId] =
          line.fulfilmentType === 'make_to_stock' ? true : next
      }
      // Preserve any other keys (defensive; shouldn't happen post-effect).
      for (const k of Object.keys(prev)) {
        if (!(k in updated)) updated[k] = prev[k]
      }
      return updated
    })
  }
  const anyCustom = Object.values(perLineShipTo).some((v) => v === null)
  const allCustom = Object.values(perLineShipTo).every((v) => v === null)
  const mixedCustom = !inventoryMode && anyCustom && !allCustom
  const customAddressErrors = {
    address: !inventoryMode && allCustom && !customAddress.address ? 'Street address is required.' : null,
    city: !inventoryMode && allCustom && !customAddress.city ? 'City is required.' : null,
    country: !inventoryMode && allCustom && !customAddress.country ? 'Country is required.' : null,
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
    !buyerMisconfigured &&
    !mixedInventory &&
    intent !== null

  function proceedToReview() {
    if (!canSubmitOrder || intent === null) return
    setSubmitting('review')
    setBanner(null)
    try {
      writeCheckoutReviewState({
        idempotencyKey: idempotencyKey.current,
        requiredBy,
        notes,
        intent,
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

      <section className="rounded-[32px] bg-white p-7 md:p-8">
        {inventoryMode && (
          <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm">
            <p className="font-medium text-gray-900">Print Room warehouse</p>
            <p className="mt-1 text-xs text-gray-500">
              Stock lands on your inventory shelf at Print Room. Your account manager will
              mark it received when it arrives.
            </p>
          </div>
        )}
        <div className="divide-y divide-gray-100">
          {cart.lines.map((line) => {
            const forced = line.fulfilmentType === 'make_to_stock'
            return (
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
                hideShipTo={inventoryMode}
                inventoryEnabled={
                  canRouteToInventory
                    ? inventoryByLine[line.lineId] ?? false
                    : undefined
                }
                onInventoryChange={
                  canRouteToInventory
                    ? (next) =>
                        setInventoryByLine((prev) => ({
                          ...prev,
                          [line.lineId]: forced ? true : next,
                        }))
                    : undefined
                }
                inventoryToggleForced={canRouteToInventory && forced}
              />
            )
          })}
        </div>
        {canRouteToInventory && (
          <div className="mt-5 flex justify-end">
            <AddAllToInventoryToggle
              checked={allInventory}
              onChange={setAllInventory}
              disabled={submitting !== false}
            />
          </div>
        )}
      </section>

      {mixedInventory && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          {hasMakeToStockLines
            ? 'Some items exceed current stock and must go to production — tick "Add all to my inventory" to continue.'
            : 'All lines must go to the same destination — either tick "Add all to my inventory" or untick all.'}
        </div>
      )}

      {mixedCustom && (
        <p className="mt-3 text-sm text-red-600">
          Custom addresses can't be mixed with store ship-tos in v1. Either pick a store
          for every line, or select "Custom address…" on every line and fill in one
          shared address below.
        </p>
      )}

      {!inventoryMode && allCustom && (
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
            placeholder="e.g. Purchase order"
            aria-label="Order notes, e.g. Purchase order"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400"
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
          className="rounded-full bg-black/[0.85] px-6 py-3 text-sm font-medium text-[#FAFAFA] transition-colors duration-300 hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === 'review' ? 'Preparing review…' : 'Review order'}
        </button>
      </div>
        </div>
      </div>
    </div>
  )
}
