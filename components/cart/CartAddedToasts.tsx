'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCartDrawer } from '@/components/layout/PortalTopBarContext'
import type { CartAddedSummary } from '@/lib/cart/added-toast'

interface ActiveToast extends CartAddedSummary {
  id: number
}

const AUTO_DISMISS_MS = 3500
const EXIT_MS = 220
const MAX_VISIBLE = 3

/**
 * "Added to cart" toast stack, pinned top-right just under the floating top
 * bar (`--portal-topbar-h`). CartProvider dispatches one coalesced
 * `pr:cart-added` CustomEvent per add action; each becomes a card that
 * auto-dismisses, can be closed, and opens the cart drawer on click. The live
 * region is always mounted so screen readers announce new items. Rendered once
 * in PortalShell.
 */
export function CartAddedToasts() {
  const [toasts, setToasts] = useState<ActiveToast[]>([])
  const idRef = useRef(0)

  useEffect(() => {
    function onAdded(e: Event) {
      const detail = (e as CustomEvent<CartAddedSummary>).detail
      if (!detail) return
      const id = ++idRef.current
      setToasts((prev) => [{ ...detail, id }, ...prev].slice(0, MAX_VISIBLE))
    }
    window.addEventListener('pr:cart-added', onAdded)
    return () => window.removeEventListener('pr:cart-added', onAdded)
  }, [])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed right-3 z-[70] flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2"
      style={{ top: 'var(--portal-topbar-h, 76px)' }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onRemove={remove} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onRemove,
}: {
  toast: ActiveToast
  onRemove: (id: number) => void
}) {
  const cartDrawer = useCartDrawer()
  const [leaving, setLeaving] = useState(false)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const beginExit = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current)
    setLeaving(true)
    exitTimer.current = setTimeout(() => onRemove(toast.id), EXIT_MS)
  }, [onRemove, toast.id])

  useEffect(() => {
    autoTimer.current = setTimeout(beginExit, AUTO_DISMISS_MS)
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current)
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [beginExit])

  function openCart() {
    cartDrawer.setOpen(true)
    beginExit()
  }

  return (
    <div
      className={`pointer-events-auto relative overflow-hidden rounded-3xl bg-white p-3 shadow-lg ring-1 ring-black/5 motion-reduce:animate-none ${
        leaving
          ? 'animate-out fade-out slide-out-to-right-4 duration-200'
          : 'animate-in fade-in slide-in-from-top-3 duration-300'
      }`}
    >
      <button
        type="button"
        onClick={openCart}
        className="flex w-full items-center gap-3 pr-7 text-left transition-opacity hover:opacity-90 focus:outline-none"
      >
        <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white">
          {toast.imageUrl ? (
            <Image
              src={toast.imageUrl}
              alt=""
              fill
              sizes="64px"
              className="object-contain p-1.5"
              unoptimized
            />
          ) : null}
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-gray-500">Added!</span>
          <span className="mt-0.5 block line-clamp-2 text-sm font-medium leading-snug text-gray-900">
            {toast.title}
          </span>
          {toast.detail ? (
            <span className="mt-0.5 block truncate text-xs text-gray-500">
              {toast.detail}
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={beginExit}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}
