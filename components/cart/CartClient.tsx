'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from './useCart'
import { CartTable } from './CartTable'

interface CartClientProps {
  defaultDepositPercent: number | null
  paymentTerms: string | null
  customerCodeMissing: boolean
}

export function CartClient({
  defaultDepositPercent,
  paymentTerms,
  customerCodeMissing,
}: CartClientProps) {
  const cart = useCart()
  const router = useRouter()
  const [oversell, setOversell] = useState(false)

  const handleOversellChange = useCallback((next: boolean) => {
    setOversell(next)
  }, [])

  const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)
  const depositPct = defaultDepositPercent ?? 0
  const depositAmount = (subtotal * depositPct) / 100

  const canCheckout = cart.lines.length > 0 && !oversell && !customerCodeMissing

  return (
    <div className="p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Cart</h1>

      {customerCodeMissing && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Your account is pending setup — staff need to assign your customer code
          before you can place orders. Contact{' '}
          <a className="underline" href="mailto:sales@theprint-room.co.nz">sales@theprint-room.co.nz</a>.
        </div>
      )}

      <CartTable
        lines={cart.lines}
        onUpdateQty={(id, qty) => cart.updateLine(id, { qty })}
        onRemove={cart.removeLine}
        onOversellChange={handleOversellChange}
      />

      {cart.lines.length > 0 && (
        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1 text-sm">
            <div className="text-lg">
              Subtotal:{' '}
              <span className="font-semibold text-gray-900">${subtotal.toFixed(2)}</span>
            </div>
            {depositPct > 0 && (
              <div className="text-gray-600">
                Expected deposit ({depositPct}%):{' '}
                <span className="font-medium text-gray-900">${depositAmount.toFixed(2)}</span>
              </div>
            )}
            {paymentTerms && (
              <div className="text-gray-500">
                Payment terms: <span className="font-medium text-gray-700">{paymentTerms}</span>
              </div>
            )}
            {oversell && (
              <div className="text-red-600">
                One or more lines exceed available stock. Reduce quantities to proceed.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => cart.clear()}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear cart
            </button>
            <button
              type="button"
              onClick={() => router.push('/checkout')}
              disabled={!canCheckout}
              className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 ease-spring hover:bg-pr-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Proceed to checkout
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
