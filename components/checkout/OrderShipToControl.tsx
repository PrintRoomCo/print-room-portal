'use client'

import type { StoreOption } from './ShipToRow'

/**
 * Where the whole order ships when it ships to ONE place. Discriminated rather
 * than a bare string so a caller can never confuse "the store whose id is
 * __custom__" with the one-time address mode; the sentinel stays inside this
 * component.
 *
 * Splitting is deliberately NOT a variant here. It is a separate mode, toggled
 * by SplitShipmentToggle, that suspends this control rather than replacing its
 * value: keeping the two orthogonal is what lets the customer flip split off
 * and land back on the store they had picked.
 */
export type OrderShipToValue = { kind: 'store'; storeId: string } | { kind: 'custom' }

const CUSTOM_SENTINEL = '__custom__'

interface OrderShipToControlProps {
  stores: StoreOption[]
  value: OrderShipToValue
  onChange: (next: OrderShipToValue) => void
  /** The one-time address option, governed by the existing buyer-misconfigured rules. */
  allowCustom: boolean
  /** True while a submit is in flight, or while split mode owns the destinations. */
  disabled?: boolean
}

export function OrderShipToControl({
  stores,
  value,
  onChange,
  allowCustom,
  disabled = false,
}: OrderShipToControlProps) {
  const selectValue = value.kind === 'store' ? value.storeId : CUSTOM_SENTINEL

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Ships to</span>
      <select
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value
          if (next === CUSTOM_SENTINEL) onChange({ kind: 'custom' })
          else onChange({ kind: 'store', storeId: next })
        }}
        disabled={disabled}
        className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30 disabled:bg-gray-100"
      >
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name ?? 'Store'}
            {store.city ? `, ${store.city}` : ''}
          </option>
        ))}
        {allowCustom && <option value={CUSTOM_SENTINEL}>Pick a one-time address</option>}
      </select>
    </label>
  )
}
