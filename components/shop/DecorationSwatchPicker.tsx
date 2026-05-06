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
  selectedLinkIds: ReadonlySet<string>
  onChange: (next: ReadonlySet<string>) => void
}

export function DecorationSwatchPicker({
  decorations,
  selectedLinkIds,
  onChange,
}: DecorationSwatchPickerProps) {
  const sorted = useMemo(
    () => [...decorations].sort((a, b) => a.sortOrder - b.sortOrder),
    [decorations],
  )

  const selectedTotal = useMemo(() => {
    let s = 0
    for (const d of sorted) if (selectedLinkIds.has(d.linkId)) s += d.unitPrice
    return s
  }, [sorted, selectedLinkIds])

  const selectedCount = sorted.reduce(
    (n, d) => (selectedLinkIds.has(d.linkId) ? n + 1 : n),
    0,
  )

  if (sorted.length === 0) return null

  function toggle(linkId: string) {
    const next = new Set(selectedLinkIds)
    if (next.has(linkId)) {
      next.delete(linkId)
    } else {
      next.add(linkId)
    }
    onChange(next)
  }

  function clearAll() {
    onChange(new Set())
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-900">Decoration</label>
        <span className="text-sm text-gray-600">
          {selectedCount === 0
            ? 'None selected'
            : `${selectedCount} selected · +$${selectedTotal.toFixed(2)} / unit`}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {sorted.map((d) => {
          const selected = selectedLinkIds.has(d.linkId)
          const methodShort = METHOD_SHORTHAND[d.method] ?? d.method.toUpperCase()
          const caption = [methodShort, d.positionLabel].filter(Boolean).join(' · ')
          const imgSrc = d.snapshotUrl ?? d.artworkUrl
          return (
            <button
              key={d.linkId}
              type="button"
              onClick={() => toggle(d.linkId)}
              aria-pressed={selected}
              aria-label={`${selected ? 'Deselect' : 'Select'} ${d.name}`}
              title={`${d.name} · +$${d.unitPrice.toFixed(2)} / unit`}
              className="group flex flex-col items-center gap-1.5"
            >
              <span
                className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border-2 bg-white transition-all duration-200 ease-spring ${
                  selected
                    ? 'border-pr-blue ring-2 ring-pr-blue/30'
                    : 'border-gray-200 opacity-70 group-hover:opacity-100 group-hover:border-gray-400'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
                {selected && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-pr-blue text-[10px] font-bold text-white shadow">
                    ✓
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium leading-tight text-gray-700">
                {caption || d.name}
              </span>
              <span className="text-[10px] tabular-nums text-gray-500">
                +${d.unitPrice.toFixed(2)}
              </span>
            </button>
          )
        })}

        <button
          type="button"
          onClick={clearAll}
          aria-pressed={selectedCount === 0}
          className={`flex h-12 items-center self-start rounded-full border px-3 text-xs font-medium transition-colors duration-200 ease-spring ${
            selectedCount === 0
              ? 'border-pr-blue bg-pr-blue/10 text-pr-blue'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
          }`}
        >
          None
        </button>
      </div>
    </div>
  )
}
