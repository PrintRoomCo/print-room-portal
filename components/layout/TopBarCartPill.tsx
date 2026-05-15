'use client'

import { useCart } from '@/components/cart/useCart'
import { useCartDrawer } from './PortalTopBarContext'

export function TopBarCartPill() {
  const cart = useCart()
  const drawer = useCartDrawer()
  const totalQty = cart.lines.reduce((sum, l) => sum + l.qty, 0)
  return (
    <button
      type="button"
      onClick={drawer.toggle}
      aria-expanded={drawer.open}
      aria-label={`Cart, ${totalQty} ${totalQty === 1 ? 'item' : 'items'}`}
      className="inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-gray-100 px-3 py-1.5 text-sm tabular-nums text-gray-900 transition-colors hover:bg-gray-200"
    >
      {totalQty}
    </button>
  )
}
