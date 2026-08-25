'use client'

import Image from 'next/image'
import {
  allInLineTotal,
  allInUnitPrice,
  cartLineDisplayImageUrl,
  type CartLine,
} from '@/lib/cart/types'
import { PrepaidBadge, PrepaidLinePrice } from './PrepaidLinePrice'

export interface StoreOption {
  id: string
  name: string | null
  city: string | null
  /** Free-text ship-to country. Loaded by BOTH checkout pages; it region-gates
   *  the NZ picking fee, so a page that omits it would quote a $0 fee while the
   *  other quotes $15. */
  country?: string | null
}

export const CUSTOM_SHIP_TO = '__custom__'

interface ShipToRowProps {
  line: CartLine
  stores: StoreOption[]
  /** `null` = custom address for this line (triggers all-or-none enforcement at the parent). */
  value: string | null
  onChange: (nextStoreId: string | null) => void
  /** Currency formatter from the parent (CheckoutClient already holds one). */
  format: (amount: number) => string
  disabled?: boolean
  /** Whether the one-time address option is available. */
  allowCustom?: boolean
  catalogueFrontImageUrl?: string | null
  /**
   * When true, hide the per-line ship-to control. Used by CheckoutClient when the
   * whole order routes to inventory (order-level "Add all to my inventory");
   * there is no per-line destination in that mode.
   */
  hideShipTo?: boolean
  /**
   * From the billed shape (never a local guess): true ⇒ this line is a prepaid
   * stock draw and is invoiced at $0.
   */
  prepaidDrawn?: boolean
  /** Exact all-in unit price from the prepared destination-country partition. */
  billedUnitPrice?: number
  /** Full goods value from the billed shape. Falls back to the cart's own
   *  all-in line total when the shape hasn't resolved yet. */
  billedGoodsValue?: number
}

export function ShipToRow({
  line,
  stores,
  value,
  onChange,
  format,
  disabled,
  allowCustom = true,
  catalogueFrontImageUrl = null,
  hideShipTo = false,
  prepaidDrawn = false,
  billedUnitPrice,
  billedGoodsValue,
}: ShipToRowProps) {
  const selectValue = value ?? CUSTOM_SHIP_TO
  const imageUrl = cartLineDisplayImageUrl(line, { catalogueFrontImageUrl })

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 bg-white text-sm">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-gray-50">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="96px"
              className="object-contain p-1"
              unoptimized
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-gray-900">{line.productName}</div>
          {prepaidDrawn && <PrepaidBadge />}
          <div className="text-xs text-gray-500">{line.variantLabel}</div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-4">
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
                  {s.city ? `, ${s.city}` : ''}
                </option>
              ))}
              {allowCustom && <option value={CUSTOM_SHIP_TO}>Pick a one-time address</option>}
            </select>
          </label>
        )}
        <div className="text-right">
          <div className="text-xs text-gray-500">
            <span className="tabular-nums text-gray-600">
              {format(billedUnitPrice ?? allInUnitPrice(line))}
            </span>
            <span className="px-1.5 text-gray-300">×</span>
            <span className="tabular-nums text-gray-600">{line.qty}</span>
          </div>
          <div className="mt-2 text-base">
            <PrepaidLinePrice
              goodsValue={billedGoodsValue ?? allInLineTotal(line)}
              billed={!prepaidDrawn}
              format={format}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
