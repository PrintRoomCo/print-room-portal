'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { ShipToRow, type StoreOption } from './ShipToRow'
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { formatPrice } from '@/lib/format/price'
import { decorationPerUnit } from '@/lib/cart/types'

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

interface CheckoutResponse {
  order_id: string
  order_ref: string
}

interface CustomAddress {
  name: string
  address: string
  city: string
  postal_code: string
  country: string
}

const EMPTY_CUSTOM: CustomAddress = {
  name: '',
  address: '',
  city: '',
  postal_code: '',
  country: 'NZ',
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

  const [customAddress, setCustomAddress] = useState<CustomAddress>(EMPTY_CUSTOM)
  const [requiredBy, setRequiredBy] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [submitting, setSubmitting] = useState<false | 'order'>(false)
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)
  // Slice 4: admin-only "send this batch to inventory instead of a customer
  // address" toggle. Only meaningful for orgs that track stock.
  const canRouteToInventory =
    !isBuyer && (tenantType === 'studio_plus_inventory' || tenantType === 'franchise')
  const [routeToInventory, setRouteToInventory] = useState(false)
  const intent: 'customer' | 'inventory' =
    canRouteToInventory && routeToInventory ? 'inventory' : 'customer'

  const anyCustom = Object.values(perLineShipTo).some((v) => v === null)
  const allCustom = Object.values(perLineShipTo).every((v) => v === null)
  const mixedCustom = anyCustom && !allCustom
  const customIncomplete =
    allCustom && (!customAddress.address || !customAddress.city || !customAddress.country)

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

  async function submitOrder() {
    setSubmitting('order')
    setBanner(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey.current,
          required_by: requiredBy || null,
          notes: notes || null,
          intent,
          lines: cart.lines.map((l) => ({
            product_id: l.productId,
            product_name: l.productName,
            variant_id: l.variantId,
            qty: l.qty,
            ship_to_store_id: allCustom ? null : perLineShipTo[l.lineId] ?? null,
            cart_line_id: l.lineId,
            decorations: l.decorations,
          })),
          custom_shipping_address: allCustom ? customAddress : null,
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
            msg: `Minimum order quantity not met — review your cart. ${summary}`,
          })
          router.push('/cart')
          return
        }
        if (data.error === 'decoration_price_drift' && data.drift) {
          const summary = data.drift
            .map((d) => `${d.decorationName}: was $${d.was.toFixed(2)} → now $${d.now.toFixed(2)} (${d.reason})`)
            .join('; ')
          setBanner({
            kind: 'error',
            msg: `Decoration pricing has changed — review your cart. ${summary}`,
          })
          router.push('/cart')
          return
        }
        if (data.error === 'insufficient_stock' || data.error === 'no_inventory') {
          const offendingLine = cart.lines.find(
            (l) =>
              (l.variantId ?? null) === (data.detail?.variant_id ?? null) ||
              l.productId === data.detail?.product_id,
          )
          const lineLabel = offendingLine?.productName ?? 'A product in your cart'
          const msg =
            data.error === 'insufficient_stock'
              ? `Sorry, ${lineLabel} went out of stock` +
                (data.detail?.available != null && data.detail?.requested != null
                  ? ` — you asked for ${data.detail.requested}, only ${data.detail.available} available.`
                  : '.') +
                ' Please reduce the quantity or remove it.'
              : `Sorry, ${lineLabel} is not stocked for your account — please contact staff or remove it from your cart.`
          setBanner({ kind: 'error', msg })
          router.push('/cart')
          return
        }
        setBanner({
          kind: 'error',
          msg: 'Stock changed while you were checking out — please review your cart and try again.',
        })
        router.push('/cart')
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }
      const result = (await res.json()) as CheckoutResponse
      cart.clear()
      router.push(`/checkout/confirmation/${result.order_id}`)
    } catch (e) {
      setBanner({ kind: 'error', msg: (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  if (cart.lines.length === 0) {
    return (
      <div className="p-4 md:p-8">
        <PortalEmptyState
          title="Checkout is ready when your cart is"
          body="Add products from your catalogue, then return here to confirm shipping and submit the order."
          actionHref="/shop"
          actionLabel="Browse catalogue"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Step 3 of 3</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">Checkout</h1>
        <p className="mt-1 text-sm text-gray-600">
          Confirm shipping and submit against your account terms.
        </p>
      </div>

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
          A deposit of {depositPct}% ({formatPrice(depositAmount)}) will be
          invoiced up-front. Balance on {paymentTerms ?? 'net20'}.
        </div>
      )}

      {canRouteToInventory && (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={routeToInventory}
              onChange={(e) => setRouteToInventory(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-pr-blue focus:ring-pr-blue/30"
              disabled={submitting !== false}
            />
            <span className="text-sm">
              <span className="font-medium text-gray-900">Add to my inventory</span>
              <span className="ml-1 text-gray-500">
                — produce these items to restock my shelf, not for a customer. Your account
                manager will mark each variant received when stock lands.
              </span>
            </span>
          </label>
        </section>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
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
        <section className="mt-4 rounded-xl border border-gray-100 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Custom shipping address</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              placeholder="Recipient name"
              value={customAddress.name}
              onChange={(e) => setCustomAddress({ ...customAddress, name: e.target.value })}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              placeholder="Street address"
              value={customAddress.address}
              onChange={(e) => setCustomAddress({ ...customAddress, address: e.target.value })}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              placeholder="City"
              value={customAddress.city}
              onChange={(e) => setCustomAddress({ ...customAddress, city: e.target.value })}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              placeholder="Postal code"
              value={customAddress.postal_code}
              onChange={(e) =>
                setCustomAddress({ ...customAddress, postal_code: e.target.value })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              placeholder="Country"
              value={customAddress.country}
              onChange={(e) =>
                setCustomAddress({ ...customAddress, country: e.target.value })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-2">
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

      <section className="mt-6 rounded-xl border border-gray-100 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-gray-700">Pricing for</span>
          <TierBadge label={pricingCtx.tierLabel} pricingMode={pricingCtx.pricingMode} />
        </div>
        <PriceBreakdown breakdown={breakdown} variant="checkout-review" />
      </section>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={submitOrder}
          disabled={!canSubmitOrder}
          className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === 'order' ? 'Placing order…' : 'Submit order'}
        </button>
      </div>
    </div>
  )
}
