'use client'

import { useEffect, useState } from 'react'

interface InvoiceCurrencyInfoProps {
  /** Billing currencies across the order's country groups; deduplicated here. */
  billingCurrencies: string[]
  displayCurrency: string
  /** 'up' when the mount sits at the bottom of an overflow-hidden panel. */
  direction?: 'up' | 'down'
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The /checkout counterpart of PickingFeeInfo: while the page shows totals in
 * the viewer's display currency, this names the currency (or per-country set)
 * the invoice will actually be raised in. Billing currency is per destination
 * country, so a mixed-destination cart lists a set.
 *
 * Renders nothing when the invoice currency IS the display currency: warning
 * someone that NZD will be invoiced as NZD is noise (spec D5).
 */
export function InvoiceCurrencyInfo({
  billingCurrencies,
  displayCurrency,
  direction = 'down',
}: InvoiceCurrencyInfoProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const distinct = Array.from(new Set(billingCurrencies))
  if (distinct.length === 0 || (distinct.length === 1 && distinct[0] === displayCurrency)) {
    return null
  }

  const copy =
    distinct.length === 1
      ? `You will be invoiced in ${distinct[0]}. Converted totals are an estimate at today's rate.`
      : `This order is invoiced per destination country: ${listJoin(distinct)}. Converted totals are an estimate at today's rate.`

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Invoicing currency"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-medium leading-none text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        i
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Invoicing currency"
          className={`absolute left-0 z-30 w-60 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg ${
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="text-xs leading-snug text-gray-600">{copy}</p>
        </div>
      )}
    </span>
  )
}
