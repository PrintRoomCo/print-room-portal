'use client'

import Link from 'next/link'
import { useCart } from '@/components/cart/useCart'

export function TopBarCartPill() {
  const cart = useCart()
  const totalQty = cart.lines.reduce((sum, l) => sum + l.qty, 0)
  return (
    <Link
      href="/cart"
      aria-label={`Cart (${totalQty} ${totalQty === 1 ? 'item' : 'items'})`}
      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900"
    >
      <span>Cart</span>
      <span className="tabular-nums">{totalQty}</span>
    </Link>
  )
}
