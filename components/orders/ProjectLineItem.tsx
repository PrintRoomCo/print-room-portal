'use client'

import {
  getItemColorHex,
  getItemColorName,
  getItemDesignName,
  getItemDisplayName,
  getItemTotalQty,
  type QuoteDataItem,
} from '@/lib/job-tracker'

export interface ProjectLineItemProps {
  item: QuoteDataItem
  designNamesByInstanceId?: Record<string, string>
}

export function ProjectLineItem({
  item,
  designNamesByInstanceId,
}: ProjectLineItemProps) {
  const designName = getItemDesignName(item, designNamesByInstanceId)
  const productName = getItemDisplayName(item)
  const colorName = getItemColorName(item)
  const colorHex = getItemColorHex(item)
  const totalQty = getItemTotalQty(item)

  // Preserve insertion order of item.sizes — do NOT sort alphabetically.
  // Chris 2026-04-24: sizes render in the order the source provides.
  const sizeEntries = item.sizes
    ? Object.entries(item.sizes).filter(([, n]) => (n ?? 0) > 0)
    : []

  return (
    <div className="glass-chip flex gap-4 p-3 sm:p-4">
      {/* Content column — no thumbnail per §15.1 */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <h5
          className="font-semibold text-black text-sm truncate"
          title={designName}
        >
          {designName}
        </h5>

        <p
          className="text-xs text-gray-700 truncate"
          title={productName}
        >
          {productName}
        </p>

        {colorName && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gray-200 bg-white text-xs text-gray-700 self-start mt-0.5">
            {colorHex && (
              <span
                className="w-3 h-3 rounded-full border border-gray-200"
                style={{ backgroundColor: colorHex }}
                aria-hidden="true"
              />
            )}
            <span>{colorName}</span>
          </span>
        )}
      </div>

      {/* Right column — sizes + total */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1.5 min-w-[100px]">
        <div className="flex flex-wrap gap-1 justify-end">
          {sizeEntries.length > 0 ? (
            sizeEntries.map(([size, qty]) => (
              <span
                key={size}
                className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-gray-200 bg-white text-[11px] font-medium text-gray-700"
                title={`${size}: ${qty}`}
              >
                {size}:{qty}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-gray-400">No size breakdown</span>
          )}
        </div>
        <p className="text-sm font-semibold text-black">
          {totalQty}{' '}
          <span className="font-normal text-gray-500 text-xs">total</span>
        </p>
      </div>
    </div>
  )
}
