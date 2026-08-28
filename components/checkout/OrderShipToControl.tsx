'use client'

import type { StoreOption } from './ShipToRow'

/**
 * Where the whole order ships. Discriminated rather than a bare string so a
 * caller can never confuse "the store whose id is __split__" with the split
 * mode; the sentinels below stay inside this component.
 */
export type OrderShipToValue =
  | { kind: 'store'; storeId: string }
  | { kind: 'custom' }
  | { kind: 'split' }

const CUSTOM_SENTINEL = '__custom__'
const SPLIT_SENTINEL = '__split__'

interface OrderShipToControlProps {
  stores: StoreOption[]
  value: OrderShipToValue
  onChange: (next: OrderShipToValue) => void
  /** The one-time address option, governed by the existing buyer-misconfigured rules. */
  allowCustom: boolean
  /**
   * Branch-scoped buyers CAN split, within their granted branches (the editor
   * filters their choices). This is false only while a submit is in flight.
   */
  allowSplit: boolean
  disabled?: boolean
}

export function OrderShipToControl({
  stores,
  value,
  onChange,
  allowCustom,
  allowSplit,
  disabled = false,
}: OrderShipToControlProps) {
  const selectValue =
    value.kind === 'store'
      ? value.storeId
      : value.kind === 'custom'
        ? CUSTOM_SENTINEL
        : SPLIT_SENTINEL

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Ships to</span>
      <select
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value
          if (next === CUSTOM_SENTINEL) onChange({ kind: 'custom' })
          else if (next === SPLIT_SENTINEL) onChange({ kind: 'split' })
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
        {allowSplit && <option value={SPLIT_SENTINEL}>Split shipment across destinations</option>}
      </select>
    </label>
  )
}
