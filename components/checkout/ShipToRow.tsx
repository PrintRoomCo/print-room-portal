'use client'

import Image from 'next/image'
import { cartLineDisplayImageUrl, type CartLine } from '@/lib/cart/types'
import { Switch } from '@/components/ui/Switch'

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
  /** Buyers can't ship to a custom address — hide the option entirely. Defaults to true (org_admin behaviour). */
  allowCustom?: boolean
  /**
   * When true, hide the ship-to <select>. Used by CheckoutClient when the
   * order routes to inventory — the per-line inventory toggle stays
   * visible so customers can untick individual lines back to customer-route.
   */
  hideShipTo?: boolean
  /**
   * Per-line "Add to my inventory" toggle state. Pass `undefined` to omit
   * the toggle entirely (e.g. for buyers or tenants without inventory
   * tracking).
   */
  inventoryEnabled?: boolean
  onInventoryChange?: (next: boolean) => void
  /**
   * When true, the toggle is forced ON and read-only. Used for
   * `fulfilmentType === 'make_to_stock'` lines — qty exceeds available
   * stock so they must go to production → inventory.
   */
  inventoryToggleForced?: boolean
}

export function ShipToRow({
  line,
  stores,
  value,
  onChange,
  disabled,
  allowCustom = true,
  hideShipTo = false,
  inventoryEnabled,
  onInventoryChange,
  inventoryToggleForced = false,
}: ShipToRowProps) {
  const selectValue = value ?? CUSTOM_SHIP_TO
  const showInventoryToggle = inventoryEnabled !== undefined && onInventoryChange !== undefined
  const decorationCount = line.decorations.length
  const imageUrl = cartLineDisplayImageUrl(line)

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 bg-white py-5 text-sm first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-50">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="80px"
              className="object-contain p-1"
              unoptimized
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-gray-900">{line.productName}</div>
          <div className="text-xs text-gray-500">{line.variantLabel}</div>
          <div className="text-xs text-gray-500">qty {line.qty}</div>
          {decorationCount > 0 && (
            <div className="text-xs text-gray-500">
              {decorationCount === 1 ? '1 decoration' : `${decorationCount} decorations`}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        {!hideShipTo && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Ship to</span>
            <select
              value={selectValue}
              onChange={(e) =>
                onChange(e.target.value === CUSTOM_SHIP_TO ? null : e.target.value)
              }
              disabled={disabled}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30 disabled:bg-gray-100"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? 'Store'}
                  {s.city ? ` — ${s.city}` : ''}
                </option>
              ))}
              {allowCustom && <option value={CUSTOM_SHIP_TO}>Custom address…</option>}
            </select>
          </label>
        )}
        {showInventoryToggle && (
          <div className="flex flex-col items-end gap-0.5">
            <label className="flex items-center gap-2">
              <span className="text-xs text-gray-600">Add to inventory</span>
              <Switch
                checked={inventoryEnabled}
                onChange={onInventoryChange}
                disabled={disabled || inventoryToggleForced}
                size="sm"
                ariaLabel={`Add ${line.productName} (${line.variantLabel}) to my inventory`}
              />
            </label>
            {inventoryToggleForced && (
              <span className="text-[10px] text-amber-700">
                over current stock — production required
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
