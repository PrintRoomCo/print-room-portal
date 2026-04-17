'use client'

import type { GarmentLine, CatalogData, PricingResult } from './QuoteBuilder'
import { GarmentLineItem } from './GarmentLineItem'

interface Props {
  lines: GarmentLine[]
  catalog: CatalogData
  pricing: PricingResult | null
  onLineChange: (idx: number, line: GarmentLine) => void
  onAddLine: () => void
  onRemoveLine: (idx: number) => void
  onOpenDesignPicker: (lineIdx: number, decoIdx: number) => void
  quoteSessionId: string
  artworkUploadUrl: string
}

export function GarmentLinesForm({
  lines, catalog, pricing, onLineChange, onAddLine, onRemoveLine,
  onOpenDesignPicker, quoteSessionId, artworkUploadUrl,
}: Props) {
  return (
    <div>
      {lines.map((line, idx) => (
        <GarmentLineItem
          key={idx}
          index={idx}
          line={line}
          catalog={catalog}
          linePricing={pricing?.lines.find(l => l.garmentLineIndex === idx) || null}
          onChange={(updated) => onLineChange(idx, updated)}
          onRemove={lines.length > 1 ? () => onRemoveLine(idx) : undefined}
          onOpenDesignPicker={(decoIdx) => onOpenDesignPicker(idx, decoIdx)}
          quoteSessionId={quoteSessionId}
          artworkUploadUrl={artworkUploadUrl}
        />
      ))}

      <button className="btn-secondary" onClick={onAddLine}>
        + Add another garment line
      </button>
    </div>
  )
}
