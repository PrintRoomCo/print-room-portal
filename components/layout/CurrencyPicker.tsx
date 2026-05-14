'use client'

import { useCurrency } from '@/contexts/CurrencyContext'
import { CURRENCY_OPTIONS, type SupportedCurrency } from '@/lib/currency/types'

export function CurrencyPicker() {
  const { currency, setCurrency } = useCurrency()
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <span className="sr-only">Currency</span>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
        aria-label="Currency"
        className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-gray-700 focus:border-gray-400 focus:outline-none"
      >
        {CURRENCY_OPTIONS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
    </label>
  )
}
