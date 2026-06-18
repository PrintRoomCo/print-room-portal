'use client'

import { useMemo } from 'react'
import type { DecorationOption } from '@/lib/shop/decorations'

const METHOD_SHORTHAND: Record<string, string> = {
  screenprint: 'SP',
  embroidery: 'EMB',
  heatpress: 'HP',
  supacolour: 'SC',
  dtf: 'DTF',
  // Image-first "custom mockup" baked decorations carry the neutral 'custom' method.
  custom: 'Custom',
}

interface DecorationSwatchPickerProps {
  decorations: DecorationOption[]
}

export function DecorationSwatchPicker({
  decorations,
}: DecorationSwatchPickerProps) {
  const sorted = useMemo(
    () => [...decorations].sort((a, b) => a.sortOrder - b.sortOrder),
    [decorations],
  )

  if (sorted.length === 0) return null

  // Per-decoration unit prices are intentionally hidden — decoration cost is
  // rolled into the all-in unit price in the price block + each volume bracket
  // row. Surfacing it twice was confusing customers.
  return (
    <div>
      <div className="mb-2">
        <label className="text-sm font-medium text-gray-900">
          Decoration{sorted.length > 1 ? 's' : ''} included
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        {sorted.map((d) => {
          const methodShort = METHOD_SHORTHAND[d.method] ?? d.method.toUpperCase()
          const caption = [methodShort, d.positionLabel].filter(Boolean).join(' · ')
          const imgSrc = d.snapshotUrl ?? d.artworkUrl
          return (
            <div
              key={d.linkId}
              title={d.name}
              className="flex flex-col items-center gap-1.5"
            >
              <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border-2 border-pr-blue bg-white ring-2 ring-pr-blue/30">
                {imgSrc ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={imgSrc}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] font-semibold text-gray-500">
                    {methodShort}
                  </span>
                )}
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-pr-blue text-[10px] font-bold text-white shadow">
                  ✓
                </span>
              </span>
              <span className="text-[10px] font-medium leading-tight text-gray-700">
                {caption || d.name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
