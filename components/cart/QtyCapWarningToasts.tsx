'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { QTY_CAP_WARNING_EVENT, type QtyCapWarningDetail } from '@/lib/shop/qty-cap'

interface ActiveWarning extends QtyCapWarningDetail {
  id: number
}

const AUTO_DISMISS_MS = 6000
const MAX_VISIBLE = 3

/**
 * Soft per-order-cap warning stack (Chris feature #9, warn-only). Mirrors the
 * CartAddedToasts CustomEvent pattern: ProductDetailClient dispatches one
 * `pr:qty-cap-warning` per add action that pushes a product past its cap; each
 * becomes a dismissible amber card. Rendered once in PortalShell, offset below
 * the cart-added stack so the two never overlap.
 */
export function QtyCapWarningToasts() {
  const [warnings, setWarnings] = useState<ActiveWarning[]>([])
  const idRef = useRef(0)

  useEffect(() => {
    function onWarning(e: Event) {
      const detail = (e as CustomEvent<QtyCapWarningDetail>).detail
      if (!detail) return
      const id = ++idRef.current
      setWarnings((prev) => [{ ...detail, id }, ...prev].slice(0, MAX_VISIBLE))
    }
    window.addEventListener(QTY_CAP_WARNING_EVENT, onWarning)
    return () => window.removeEventListener(QTY_CAP_WARNING_EVENT, onWarning)
  }, [])

  const remove = useCallback((id: number) => {
    setWarnings((prev) => prev.filter((w) => w.id !== id))
  }, [])

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed right-3 z-[69] flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2"
      style={{ top: 'calc(var(--portal-topbar-h, 76px) + 8rem)' }}
    >
      {warnings.map((warning) => (
        <WarningCard key={warning.id} warning={warning} onRemove={remove} />
      ))}
    </div>
  )
}

function WarningCard({
  warning,
  onRemove,
}: {
  warning: ActiveWarning
  onRemove: (id: number) => void
}) {
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    autoTimer.current = setTimeout(() => onRemove(warning.id), AUTO_DISMISS_MS)
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current)
    }
  }, [onRemove, warning.id])

  return (
    <div className="pointer-events-auto relative overflow-hidden rounded-3xl bg-amber-50 p-4 shadow-lg ring-1 ring-amber-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">Over per-order limit</p>
          <p className="mt-1 text-xs leading-snug text-amber-800">
            {warning.productName}: cart now has {warning.total} of a suggested {warning.max}.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onRemove(warning.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amber-800 transition-colors hover:bg-amber-100"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
