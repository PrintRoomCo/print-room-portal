'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from './useCart'
import { CartTable } from './CartTable'
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
import { formatPrice } from '@/lib/format/price'
import { decorationPerUnit } from '@/lib/cart/types'

interface CartClientProps {
  defaultDepositPercent: number | null
  paymentTerms: string | null
  customerCodeMissing: boolean
}

const LABEL_CAP =
  'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500'

export function CartClient({
  defaultDepositPercent,
  paymentTerms,
  customerCodeMissing,
}: CartClientProps) {
  const cart = useCart()
  const router = useRouter()
  const [oversell, setOversell] = useState(false)
  const [moqShort, setMoqShort] = useState(false)
  const pricingCtx = usePricingContext()

  const handleOversellChange = useCallback((next: boolean) => {
    setOversell(next)
  }, [])

  const handleMoqViolationChange = useCallback((next: boolean) => {
    setMoqShort(next)
  }, [])

  const breakdown = computeOrderBreakdown({
    lines: cart.lines.map((l) => ({
      qty: l.qty,
      unitEffective: l.unitPrice,
      decorationPerUnit: decorationPerUnit(l),
    })),
    gstRate: 0.15,
  })

  const depositPct = defaultDepositPercent ?? 0
  const depositAmount = (breakdown.netSubtotal * depositPct) / 100

  const canCheckout =
    cart.lines.length > 0 && !oversell && !moqShort && !customerCodeMissing

  const itemCount = cart.lines.reduce((sum, l) => sum + l.qty, 0)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        {/* Hero — editorial H1 + item count */}
        <header className="mb-10 md:mb-12">
          <p className={LABEL_CAP}>Cart</p>
          <h1 className="mt-2 font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Your cart
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            {cart.lines.length === 0
              ? 'Add products from the catalogue to get started.'
              : `${itemCount} ${itemCount === 1 ? 'item' : 'items'} · review quantities and pricing before checkout.`}
          </p>
        </header>

        {customerCodeMissing && (
          <div className="mb-6 rounded-2xl bg-amber-50 px-5 py-3 text-sm text-amber-900">
            Your account is pending setup — staff need to assign your customer code
            before you can place orders. Contact{' '}
            <a className="underline" href="mailto:hello@theprint-room.co.nz">
              hello@theprint-room.co.nz
            </a>
            .
          </div>
        )}

        {cart.lines.length === 0 ? (
          <CartTable
            lines={cart.lines}
            onUpdateQty={(id, qty) => cart.updateLine(id, { qty })}
            onRemove={cart.removeLine}
            onOversellChange={handleOversellChange}
            onMoqViolationChange={handleMoqViolationChange}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr] lg:gap-10">
            {/* Left: line items stack */}
            <div>
              <CartTable
                lines={cart.lines}
                onUpdateQty={(id, qty) => cart.updateLine(id, { qty })}
                onRemove={cart.removeLine}
                onOversellChange={handleOversellChange}
                onMoqViolationChange={handleMoqViolationChange}
              />
            </div>

            {/* Right: sticky summary card */}
            <aside className="h-fit lg:sticky lg:top-[100px]">
              <div className="rounded-[32px] bg-white p-7 md:p-8">
                <p className={LABEL_CAP}>Order summary</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-gray-600">Pricing</span>
                  <TierBadge
                    label={pricingCtx.tierLabel}
                    pricingMode={pricingCtx.pricingMode}
                  />
                </div>

                <div className="mt-6">
                  <PriceBreakdown breakdown={breakdown} variant="cart-totals" />
                </div>

                {(depositPct > 0 || paymentTerms) && (
                  <div className="mt-4 space-y-1 text-xs text-gray-500">
                    {paymentTerms && (
                      <p>
                        Payment terms:{' '}
                        <span className="font-medium text-gray-700">
                          {paymentTerms}
                        </span>
                      </p>
                    )}
                    {depositPct > 0 && (
                      <p>
                        Expected deposit ({depositPct}%):{' '}
                        <span className="font-medium text-gray-900 tabular-nums">
                          {formatPrice(depositAmount)}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {(oversell || moqShort) && (
                  <div className="mt-4 space-y-1 rounded-2xl bg-rose-50 px-4 py-2 text-xs text-rose-700">
                    {oversell && (
                      <p>
                        One or more lines exceed available stock. Reduce
                        quantities to proceed.
                      </p>
                    )}
                    {moqShort && (
                      <p>
                        One or more products are below their minimum order
                        quantity.
                      </p>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => router.push('/checkout')}
                  disabled={!canCheckout}
                  className="mt-6 w-full rounded-full bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Checkout
                </button>

                <button
                  type="button"
                  onClick={() => router.push('/checkout?mode=quote')}
                  className="mt-2 w-full rounded-full border border-gray-200 bg-white px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  Request quote
                </button>

                <button
                  type="button"
                  onClick={() => cart.clear()}
                  className="mt-4 w-full text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 transition-colors hover:text-gray-900"
                >
                  Clear cart
                </button>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
