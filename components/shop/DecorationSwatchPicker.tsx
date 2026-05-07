'use client'

import { useMemo } from 'react'
import type { DecorationOption } from '@/lib/shop/decorations'

const METHOD_SHORTHAND: Record<string, string> = {
  screenprint: 'SP',
  embroidery: 'EMB',
  heatpress: 'HP',
  supacolour: 'SC',
  dtf: 'DTF',
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

  const total = useMemo(
    () => sorted.reduce((s, d) => s + d.unitPrice, 0),
    [sorted],
  )

  if (sorted.length === 0) return null

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-900">
          Decoration{sorted.length > 1 ? 's' : ''} included
        </label>
        <span className="text-sm text-gray-600">
          +${total.toFixed(2)} / unit
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {sorted.map((d) => {
          const methodShort = METHOD_SHORTHAND[d.method] ?? d.method.toUpperCase()
          const caption = [methodShort, d.positionLabel].filter(Boolean).join(' · ')
          const imgSrc = d.snapshotUrl ?? d.artworkUrl
          return (
            <div
              key={d.linkId}
              title={`${d.name} · +$${d.unitPrice.toFixed(2)} / unit`}
              className="flex flex-col items-center gap-1.5"
            >
              <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border-2 border-pr-blue bg-white ring-2 ring-pr-blue/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-pr-blue text-[10px] font-bold text-white shadow">
                  ✓
                </span>
              </span>
              <span className="text-[10px] font-medium leading-tight text-gray-700">
                {caption || d.name}
              </span>
              <span className="text-[10px] tabular-nums text-gray-500">
                +${d.unitPrice.toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
