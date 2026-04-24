'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCart } from './useCart'

const VISIBLE_PREFIXES = [
  '/shop',
  '/cart',
  '/checkout',
  '/order-tracker',
  '/inventory',
]

export function CartChip() {
  const pathname = usePathname() ?? ''
  const cart = useCart()

  const visible = VISIBLE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
  if (!visible) return null

  const totalQty = cart.lines.reduce((sum, l) => sum + l.qty, 0)

  return (
    <Link
      href="/cart"
      aria-label={`Cart (${totalQty} ${totalQty === 1 ? 'item' : 'items'})`}
      className="fixed right-4 top-20 z-40 flex items-center gap-2 rounded-full bg-pr-blue px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all duration-200 ease-spring hover:shadow-xl hover:brightness-110 md:right-6 md:top-6"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
      </svg>
      <span>
        Cart
        {totalQty > 0 && (
          <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
            {totalQty}
          </span>
        )}
      </span>
    </Link>
  )
}
