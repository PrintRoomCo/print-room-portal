'use client'

import { useCurrency } from '@/contexts/CurrencyContext'
import { CURRENCY_OPTIONS, type SupportedCurrency } from '@/lib/currency/types'

export function CurrencyPicker() {
  const { currency, setCurrency } = useCurrency()
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Currency</span>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
        aria-label="Currency"
        className="appearance-none rounded-full bg-gray-100 px-3 py-1.5 pr-7 text-sm text-gray-900 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        {CURRENCY_OPTIONS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" />
    </label>
  )
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 12 12" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4.5l3 3 3-3" />
    </svg>
  )
}
