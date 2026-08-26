'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { useCartLineFrontImages } from '@/components/cart/useCartLineFrontImages'
import { ShipToRow, type StoreOption } from './ShipToRow'
import {
  AddressAutocompleteInput,
  type AddressPlace,
} from '@/components/account/AddressAutocompleteInput'
import type { EnabledCountry } from '@/lib/account/org-countries'
import { AddAllToInventoryToggle } from './AddAllToInventoryToggle'
import { CheckoutCTAStickyBar } from './CheckoutCTAStickyBar'
import { CustomerCodeNotice } from './CustomerCodeNotice'
import {
  EMPTY_CUSTOM_ADDRESS,
  writeCheckoutReviewState,
  type CustomAddress,
} from './checkoutReviewState'
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
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { decorationPerUnit } from '@/lib/cart/types'
import { useCurrency } from '@/contexts/CurrencyContext'
import { useCompany } from '@/contexts/CompanyContext'
import { formatCurrency } from '@/lib/currency/format'
import {
  buildCheckoutRequestLines,
  useCheckoutPreview,
} from './useCheckoutPreview'

interface CheckoutClientProps {
  stores: StoreOption[]
  customerCode: string | null
  paymentTerms: string | null
  defaultDepositPercent: number | null
  /**
   * organizations.is_test: demo/test org gate. Suppresses the deposit /
   * payment-terms banner so a demo walkthrough never shows real terms, matching
   * the checkout review screen's suppression.
   */
  isTest: boolean
  /**
   * Per-buyer default ship-to. When set AND the store is in `stores`, every
   * line is locked to it (staff intent: this buyer always ships to this store).
   * When null, the parent falls back to `stores[0]` so the dropdown is still
   * pre-populated but editable.
   */
  defaultStoreId: string | null
  /**
   * Buyer Roles step 6: when true, saved ship-tos are limited to defaultStoreId,
   * but the one-time address path remains available. The DB CHECK guarantees
   * defaultStoreId is set for buyers, but we defend against drift by surfacing a
   * banner.
   */
  isBuyer: boolean
  /** Slice 4: gates the "Add to inventory" admin checkout toggle. */
  tenantType: 'franchise' | 'studio_plus_inventory' | 'studio' | null
  /** SP1: the org's enabled countries, the only values the one-time address may carry. */
  enabledCountries: EnabledCountry[]
  /** Default list currency, used only to label legacy persisted cart prices. */
  defaultPriceCurrency?: string | null
  /** Server-evaluated SP3 flag. Client components never read process.env. */
  countryPartitionEnabled?: boolean
}

export function CheckoutClient({
  stores,
  customerCode,
  paymentTerms,
  defaultDepositPercent,
  isTest,
  defaultStoreId: buyerDefaultStoreId,
  isBuyer,
  tenantType,
  enabledCountries,
  defaultPriceCurrency = null,
  countryPartitionEnabled = false,
}: CheckoutClientProps) {
  const cart = useCart()
  const router = useRouter()
  const currencyContext = useCurrency()
  const { format } = currencyContext
  const { defaultBillingCountry } = useCompany()
  const frontImageByLineId = useCartLineFrontImages(cart.lines)

  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const buyerDefaultIsAvailable =
    buyerDefaultStoreId != null && stores.some((s) => s.id === buyerDefaultStoreId)
  const initialStoreId = buyerDefaultIsAvailable
    ? buyerDefaultStoreId
    : stores[0]?.id ?? null
  const selectableStores =
    isBuyer && buyerDefaultIsAvailable
      ? stores.filter((store) => store.id === buyerDefaultStoreId)
      : stores
  const buyerMisconfigured = isBuyer && !buyerDefaultIsAvailable
  const [perLineShipTo, setPerLineShipTo] = useState<Record<string, string | null>>(() => {
    const m: Record<string, string | null> = {}
    for (const l of cart.lines) m[l.lineId] = initialStoreId
    return m
  })

  const [customAddress, setCustomAddress] = useState<CustomAddress>({
    ...EMPTY_CUSTOM_ADDRESS,
    country: enabledCountries.find((c) => c.isDefault)?.code ?? enabledCountries[0]?.code ?? '',
  })
  const [requiredBy, setRequiredBy] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [submitting, setSubmitting] = useState<false | 'review'>(false)
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)
  // Inventory routing is order-level only; the whole order either ships to
  // customer addresses or lands on the org's inventory shelf. There is no
  // per-line inventory choice (mixed orders aren't supported), so this is a
  // single opt-in toggle, default OFF. Offered only to inventory-tracking org
  // admins; buyers and non-stock tenants never see it.
  const canRouteToInventory =
    !isBuyer && (tenantType === 'studio_plus_inventory' || tenantType === 'franchise')
  const [addToInventory, setAddToInventory] = useState(false)

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

  const inventoryMode = canRouteToInventory && addToInventory
  const intent: 'customer' | 'inventory' = inventoryMode ? 'inventory' : 'customer'

  const anyCustom = Object.values(perLineShipTo).some((v) => v === null)
  const allCustom = Object.values(perLineShipTo).every((v) => v === null)
  const mixedCustom = !inventoryMode && anyCustom && !allCustom
  const customAddressErrors = {
    address: !inventoryMode && allCustom && !customAddress.address ? 'Street address is required.' : null,
    city: !inventoryMode && allCustom && !customAddress.city ? 'City is required.' : null,
    country: !inventoryMode && allCustom && !customAddress.country ? 'Country is required.' : null,
  }
  const customIncomplete = Object.values(customAddressErrors).some(Boolean)

  const { modeByVariantId, status: billingStatus } = useFreshBillingModes(cart.lines)
  // Hold the total back for the sub-second fresh read rather than flashing a
  // number we might not honour. 'error' is a usable fail-closed answer (empty
  // map ⇒ every line bills at full price), so only 'loading' blocks.
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
          // FRESH mode only; the cart's own billingMode snapshot is a PDP
          // reading and can be days stale. Absent ⇒ null ⇒ billed (fail closed).
          billingMode: modeByVariantId[line.variantId] ?? null,
        })),
        gstRate: defaultBillingCountry.taxRate,
        // Task 7's private flag-off adapter freezes the pre-cutover drawer
        // assumption; enabled checkout money comes only from prepared country
        // partitions below.
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

  const checkoutLines = useMemo(
    () => buildCheckoutRequestLines({
      lines: cart.lines,
      perLineShipTo,
      allCustom,
      modeByVariantId,
      defaultPriceCurrency: countryPartitionEnabled
        ? defaultPriceCurrency ?? undefined
        : undefined,
    }),
    [
      cart.lines,
      perLineShipTo,
      allCustom,
      modeByVariantId,
      countryPartitionEnabled,
      defaultPriceCurrency,
    ],
  )
  const previewRequest = useMemo(
    () =>
      countryPartitionEnabled &&
      pricingReady &&
      !mixedCustom &&
      !customIncomplete &&
      !buyerMisconfigured
        ? {
            idempotency_key: idempotencyKey,
            required_by: requiredBy || null,
            notes: notes || null,
            intent,
            lines: checkoutLines,
            custom_shipping_address: allCustom ? customAddress : null,
          }
        : null,
    [
      countryPartitionEnabled,
      pricingReady,
      mixedCustom,
      customIncomplete,
      buyerMisconfigured,
      requiredBy,
      notes,
      intent,
      checkoutLines,
      allCustom,
      customAddress,
      idempotencyKey,
    ],
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

  const lineById = useMemo(
    () => new Map(cart.lines.map((line) => [line.lineId, line])),
    [cart.lines],
  )
  const depositPct = defaultDepositPercent ?? 0
  // Off the BILLED subtotal: a deposit on stock the org already paid for would
  // be asking twice.
  const depositAmount = (shape.billedSubtotal * depositPct) / 100

  const customerCodeMissing = !customerCode
  const canSubmitOrder =
    !submitting &&
    cart.lines.length > 0 &&
    !customerCodeMissing &&
    !mixedCustom &&
    !customIncomplete &&
    !buyerMisconfigured &&
    (!countryPartitionEnabled ||
      (preview.status === 'ready' &&
        preview.partitions.length > 0 &&
        previewFailures.length === 0))

  function proceedToReview() {
    if (!canSubmitOrder) return
    setSubmitting('review')
    setBanner(null)
    try {
      writeCheckoutReviewState({
        idempotencyKey,
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

  function renderShipLine(billedLine: BilledLine, currency?: string) {
    const line = lineById.get(billedLine.lineId)
    if (!line) return null
    const lineFormat = currency
      ? (amount: number) => `${formatCurrency(amount, currency)} ${currency}`
      : format
    return (
      <ShipToRow
        line={line}
        stores={selectableStores}
        format={lineFormat}
        value={perLineShipTo[line.lineId] ?? null}
        catalogueFrontImageUrl={frontImageByLineId[line.lineId] ?? null}
        onChange={(next) =>
          setPerLineShipTo((prev) => ({ ...prev, [line.lineId]: next }))
        }
        disabled={submitting !== false}
        allowCustom={!buyerMisconfigured}
        hideShipTo={inventoryMode}
        prepaidDrawn={!billedLine.billed}
        billedUnitPrice={
          currency ? billedLine.unitPrice + billedLine.decorationPerUnit : undefined
        }
        billedGoodsValue={billedLine.goodsValue}
      />
    )
  }

  if (cart.lines.length === 0) {
    return (
      <div className="min-h-screen bg-white">
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
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-[1320px] px-4 pb-[120px] pt-[100px] md:px-6 md:pb-[96px] md:pt-[120px]">
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

      {customerCodeMissing && <CustomerCodeNotice />}

      {buyerMisconfigured && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Your default shipping store is missing or no longer assigned to your account. Please
          contact staff before submitting an order.
        </div>
      )}

      {!isTest && depositPct > 0 && countryPartitionEnabled && (
        <div className="mb-4 rounded-2xl border border-black/10 bg-white p-4 text-sm text-black/70">
          A deposit of {depositPct}% will be invoiced per order. Balance on{' '}
          {paymentTerms ?? 'net20'}.
        </div>
      )}

      {!isTest && depositPct > 0 && !countryPartitionEnabled && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          A deposit of {depositPct}% ({format(depositAmount)}) will be
          invoiced up-front. Balance on {paymentTerms ?? 'net20'}.
        </div>
      )}

      <section className="rounded-[32px] bg-white p-7 md:p-8">
        {inventoryMode && (
          <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4 text-sm">
            <p className="font-medium text-gray-900">Print Room warehouse</p>
            <p className="mt-1 text-xs text-gray-500">
              Stock lands in your 3PL inventory. Your account manager will notify you when
              it&apos;s been made.
            </p>
          </div>
        )}
        {countryPartitionEnabled ? (
          preview.status === 'ready' ? (
            <CountryBilledOrderSummary
              shape={countryShape}
              failures={previewFailures}
              renderLine={renderShipLine}
            />
          ) : (
            <div>
              <div
                role={preview.status === 'error' ? 'alert' : 'status'}
                className={
                  preview.status === 'error'
                    ? 'mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800'
                    : 'mb-5 rounded-2xl bg-white p-4 text-sm text-black/65'
                }
              >
                {preview.status === 'error'
                  ? preview.error
                  : 'Updating country prices…'}
              </div>
              <div className="space-y-6">
                {shape.partitions.flatMap((partition) => partition.lines).map((line) => (
                  <div key={line.lineId}>{renderShipLine(line)}</div>
                ))}
              </div>
            </div>
          )
        ) : (
          <BilledOrderSummary
            shape={shape}
            format={format}
            renderLine={renderShipLine}
          />
        )}
        {canRouteToInventory && (
          <div className="mt-5 flex justify-end">
            <AddAllToInventoryToggle
              checked={addToInventory}
              onChange={setAddToInventory}
              disabled={submitting !== false}
            />
          </div>
        )}
      </section>

      {mixedCustom && (
        <p className="mt-3 text-sm text-red-600">
          One-time addresses can't be mixed with store ship-tos in v1. Either pick a store
          for every line, or select "Pick a one-time address" on every line and fill in one
          shared one-time address below.
        </p>
      )}

      {!inventoryMode && allCustom && (
        <section className="mt-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">One-time shipping address</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              id="custom-shipping-name"
              placeholder="Recipient name"
              value={customAddress.name}
              onChange={(e) => setCustomAddress({ ...customAddress, name: e.target.value })}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <div>
              <AddressAutocompleteInput
                id="custom-shipping-address"
                placeholder="Street address"
                value={customAddress.address}
                onChange={(address) => setCustomAddress((a) => ({ ...a, address }))}
                onPlace={(place: AddressPlace) =>
                  setCustomAddress((a) => ({
                    ...a,
                    address: place.address ?? a.address,
                    city: place.city ?? a.city,
                    postal_code: place.postal_code ?? a.postal_code,
                    country:
                      place.country && enabledCountries.some((c) => c.code === place.country)
                        ? place.country
                        : a.country,
                  }))
                }
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
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
              <select
                id="custom-shipping-country"
                value={customAddress.country}
                onChange={(e) =>
                  setCustomAddress({ ...customAddress, country: e.target.value })
                }
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                aria-invalid={customAddressErrors.country ? true : undefined}
                aria-describedby={
                  customAddressErrors.country ? 'custom-shipping-country-error' : undefined
                }
              >
                {!customAddress.country && <option value="">Select country…</option>}
                {enabledCountries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
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

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Required-by is hidden for staff-role customers (isBuyer === role 'staff'). */}
        {!isBuyer && (
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
        )}
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

        </div>
      </div>
      <CheckoutCTAStickyBar
        itemCount={cart.lines.length}
        orderCount={
          countryPartitionEnabled
            ? Math.max(1, preview.partitions.length)
            : shape.invoiceCount
        }
        totalsByCurrency={
          countryPartitionEnabled
            ? preview.status === 'ready'
              ? preview.totalsByCurrency
              : []
            : [{
                currency: currencyContext.currency ?? defaultBillingCountry.currency,
                total: currencyContext.convert?.(shape.grandTotal) ?? shape.grandTotal,
              }]
        }
        onSubmit={proceedToReview}
        disabled={!canSubmitOrder}
        submitting={submitting === 'review'}
        legacyPresentation={
          countryPartitionEnabled
            ? undefined
            : {
                totalLabel: format(shape.grandTotal),
                actionLabel: 'Review order',
              }
        }
      />
    </div>
  )
}
