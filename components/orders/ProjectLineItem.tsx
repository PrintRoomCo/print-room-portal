'use client'

import {
  getItemArtworkUrl,
  getItemColorHex,
  getItemColorName,
  getItemDisplayName,
  getItemPrintMethod,
  getItemTotalQty,
  type QuoteDataItem,
} from '@/lib/job-tracker'

export interface ProjectLineItemProps {
  item: QuoteDataItem
  productImageUrl?: string
}

function capitalise(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function ProjectLineItem({ item, productImageUrl }: ProjectLineItemProps) {
  const displayName = getItemDisplayName(item)
  const colorName = getItemColorName(item)
  const colorHex = getItemColorHex(item)
  const printMethod = getItemPrintMethod(item)
  const artworkUrl = getItemArtworkUrl(item)
  const totalQty = getItemTotalQty(item)

  const thumbnailUrl =
    productImageUrl ?? artworkUrl ?? item.image?.url ?? undefined

  const sizeEntries = item.sizes
    ? Object.entries(item.sizes).filter(([, n]) => (n ?? 0) > 0)
    : []

  const extraLogoCount = Math.max(
    0,
    (item.customizations?.logos?.length ?? 0) - 1
  )

  return (
    <div className="glass-chip flex gap-4 p-3 sm:p-4">
      {/* Thumbnail */}
      <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100/70 border border-gray-100">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Middle column */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <h5 className="font-semibold text-black text-sm truncate" title={displayName}>
          {displayName}
        </h5>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
          {colorName && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gray-200 bg-white">
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

          {printMethod && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-200 bg-white text-gray-700">
              {capitalise(printMethod)}
            </span>
          )}

          {extraLogoCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-200 bg-white text-gray-500">
              +{extraLogoCount} more design{extraLogoCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {typeof item.subtotal === 'number' && item.subtotal > 0 && (
          <p className="text-xs text-gray-500">
            Line subtotal: ${item.subtotal.toFixed(2)}
          </p>
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
          {totalQty} <span className="font-normal text-gray-500 text-xs">total</span>
        </p>
      </div>
    </div>
  )
}
