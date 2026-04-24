'use client'

import type { CartLine } from '@/lib/cart/types'

export interface StoreOption {
  id: string
  name: string | null
  city: string | null
}

export const CUSTOM_SHIP_TO = '__custom__'

interface ShipToRowProps {
  line: CartLine
  stores: StoreOption[]
  /** `null` = custom address for this line (triggers all-or-none enforcement at the parent). */
  value: string | null
  onChange: (nextStoreId: string | null) => void
  disabled?: boolean
}

export function ShipToRow({ line, stores, value, onChange, disabled }: ShipToRowProps) {
  const selectValue = value ?? CUSTOM_SHIP_TO

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-900">{line.productName}</div>
        <div className="truncate text-xs text-gray-500">
          {line.variantLabel} · qty {line.qty}
        </div>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Ship to</span>
        <select
          value={selectValue}
          onChange={(e) => onChange(e.target.value === CUSTOM_SHIP_TO ? null : e.target.value)}
          disabled={disabled}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30 disabled:bg-gray-100"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? 'Store'}
              {s.city ? ` — ${s.city}` : ''}
            </option>
          ))}
          <option value={CUSTOM_SHIP_TO}>Custom address…</option>
        </select>
      </label>
    </div>
  )
}
