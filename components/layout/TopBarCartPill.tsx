'use client'

import Link from 'next/link'
import { useCart } from '@/components/cart/useCart'

export function TopBarCartPill() {
  const cart = useCart()
  const totalQty = cart.lines.reduce((sum, l) => sum + l.qty, 0)
  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${totalQty} ${totalQty === 1 ? 'item' : 'items'}`}
      className="inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-gray-100 px-3 py-1.5 text-sm tabular-nums text-gray-900 transition-colors hover:bg-gray-200"
    >
      {totalQty}
    </Link>
  )
}
