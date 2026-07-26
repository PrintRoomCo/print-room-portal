'use client'

import { useEffect, useRef, useState } from 'react'
import { activeBandIndex, pickingFeeBandRows } from '@/lib/pricing/picking-fee-display'

interface PickingFeeInfoProps {
  /** The goods value the fee band is derived from (partition goodsValueForBand / stocked cart goods). */
  goodsBasis: number
  format: (nzdAmount: number) => string
  /** 'up' when the mount sits at the bottom of an overflow-hidden panel (cart drawer). */
  direction?: 'up' | 'down'
}

export function PickingFeeInfo({ goodsBasis, format, direction = 'down' }: PickingFeeInfoProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const active = activeBandIndex(goodsBasis)

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label="How the picking fee is calculated"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-medium leading-none text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        i
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Picking fee bands"
          className={`absolute left-0 z-30 w-60 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg ${
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="mb-2 text-xs font-medium text-gray-900">Picking fee by goods value</p>
          <ul className="space-y-1">
            {pickingFeeBandRows().map((row, index) => (
              <li
                key={row.range}
                data-active={index === active || undefined}
                className="flex items-baseline justify-between rounded px-1.5 py-0.5 text-xs text-gray-600 data-[active]:bg-gray-100 data-[active]:font-medium data-[active]:text-gray-900"
              >
                <span>{row.range}</span>
                <span className="tabular-nums">{format(row.fee)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-gray-500">
            Applies to stock-on-hand orders delivered within NZ, based on the order&rsquo;s goods
            value.
          </p>
        </div>
      )}
    </span>
  )
}
