'use client'

import * as Dialog from '@radix-ui/react-dialog'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { decorationPerUnit } from '@/lib/cart/types'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { useCartDrawer } from '@/components/layout/PortalTopBarContext'
import { useCompany } from '@/contexts/CompanyContext'
import { useCurrency } from '@/contexts/CurrencyContext'
import { CartTable } from './CartTable'
import { useCart } from './useCart'

export function CartDrawer() {
  const cart = useCart()
  const drawer = useCartDrawer()
  const pathname = usePathname()
  const router = useRouter()
  const { format } = useCurrency()
  const { access } = useCompany()
  const [oversell, setOversell] = useState(false)
  const [moqShort, setMoqShort] = useState(false)

  // Mixed-intent split, cluster 2.6 — cart-level fast-path. Mirror the
  // PDP toggle gate (`role === 'org_admin' && tenant tracks inventory`),
  // which is equivalent to CheckoutClient's `!isBuyer && ...` because
  // the role field is binary. Hidden for studio tenants and buyers.
  const canRouteAllToInventory =
    access?.role === 'org_admin' &&
    (access.tenantType === 'studio_plus_inventory' ||
      access.tenantType === 'franchise')
  const allLinesToInventory =
    cart.lines.length > 0 && cart.lines.every((l) => l.routeToInventory === true)

  useEffect(() => {
    drawer.setOpen(false)
    // Intentionally close only on route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const handleOversellChange = useCallback((next: boolean) => {
    setOversell(next)
  }, [])

  const handleMoqViolationChange = useCallback((next: boolean) => {
    setMoqShort(next)
  }, [])

  const itemCount = cart.lines.reduce((sum, line) => sum + line.qty, 0)
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
  const canCheckout = cart.lines.length > 0 && !oversell && !moqShort

  function proceedToCheckout() {
    if (!canCheckout) return
    drawer.setOpen(false)
    router.push('/checkout')
  }

  return (
    <Dialog.Root open={drawer.open} onOpenChange={drawer.setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[85] bg-black/30 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed bottom-0 right-0 top-0 z-[90] flex w-full max-w-[440px] flex-col overflow-hidden bg-[#FAFAFA] shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-full data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full motion-reduce:transition-none sm:bottom-3 sm:right-3 sm:top-3 sm:rounded-[28px]">
          <div className="flex items-center justify-between border-b border-gray-200/70 bg-white px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="font-dm-sans text-sm font-medium uppercase tracking-[0.12em] text-gray-900">
                CART <span className="text-gray-500">({itemCount})</span>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close cart"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            <CartTable
              lines={cart.lines}
              onUpdateQty={(id, qty) => cart.updateLine(id, { qty })}
              onRemove={cart.removeLine}
              onOversellChange={handleOversellChange}
              onMoqViolationChange={handleMoqViolationChange}
            />
          </div>

          <div className="sticky bottom-0 border-t border-gray-200/70 bg-white px-5 py-4">
            {cart.lines.length > 0 ? (
              <>
                {canRouteAllToInventory && (
                  <button
                    type="button"
                    onClick={() =>
                      cart.setAllLinesRouteToInventory(!allLinesToInventory)
                    }
                    aria-pressed={allLinesToInventory ? 'true' : 'false'}
                    className={
                      'mb-3 flex w-full items-center justify-between rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.08em] transition-colors ' +
                      (allLinesToInventory
                        ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                    }
                  >
                    <span>Send entire order to my inventory</span>
                    <span className="text-[11px]">
                      {allLinesToInventory ? 'ON' : 'OFF'}
                    </span>
                  </button>
                )}
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm text-gray-500">Total</span>
                  <span className="font-dm-sans text-xl font-medium text-gray-900 tabular-nums">
                    {format(breakdown.total)}
                  </span>
                </div>
                {(oversell || moqShort) && (
                  <p className="mt-2 text-xs text-rose-700">
                    Resolve cart quantity warnings before checkout.
                  </p>
                )}
                <button
                  type="button"
                  onClick={proceedToCheckout}
                  disabled={!canCheckout}
                  className="mt-4 w-full rounded-full bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Proceed to Checkout
                </button>
              </>
            ) : (
              <Link
                href="/catalogue"
                onClick={() => drawer.setOpen(false)}
                className="block w-full rounded-full bg-gray-900 px-5 py-3 text-center text-sm font-medium text-white transition-opacity duration-150 hover:opacity-90"
              >
                Browse catalogue
              </Link>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}
