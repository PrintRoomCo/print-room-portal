'use client'

import Image from 'next/image'
import { cartLineDisplayImageUrl, type CartLine } from '@/lib/cart/types'

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
  catalogueFrontImageUrl?: string | null
  /**
   * When true, hide the per-line ship-to control. Used by CheckoutClient when the
   * whole order routes to inventory (order-level "Add all to my inventory") —
   * there is no per-line destination in that mode.
   */
  hideShipTo?: boolean
}

export function ShipToRow({
  line,
  stores,
  value,
  onChange,
  disabled,
  allowCustom = true,
  catalogueFrontImageUrl = null,
  hideShipTo = false,
}: ShipToRowProps) {
  const selectValue = value ?? CUSTOM_SHIP_TO
  const decorationCount = line.decorations.length
  const imageUrl = cartLineDisplayImageUrl(line, { catalogueFrontImageUrl })

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
      {!hideShipTo && (
        <div className="flex flex-col items-end gap-2">
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
        </div>
      )}
    </div>
  )
}
