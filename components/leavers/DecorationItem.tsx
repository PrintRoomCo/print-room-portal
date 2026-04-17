'use client'

import type { Decoration, CatalogData } from './QuoteBuilder'
import { ArtworkUpload } from './ArtworkUpload'

interface Props {
  index: number
  decoration: Decoration
  productType: string
  catalog: CatalogData
  onChange: (d: Decoration) => void
  onRemove?: () => void
  onOpenDesignPicker: () => void
  quoteSessionId: string
  artworkUploadUrl: string
}

export function DecorationItem({
  index, decoration, productType, catalog, onChange, onRemove,
  onOpenDesignPicker, quoteSessionId, artworkUploadUrl,
}: Props) {
  const applicableTypes = catalog.decorationTypes.filter((dt: any) =>
    !(dt.excludedFamilies || []).some((ef: string) => ef.toLowerCase() === productType.toLowerCase())
  )

  const selectedType = catalog.decorationTypes.find((dt: any) => dt.name === decoration.decorationType)
  const details = selectedType?.details || []

  const handleTypeChange = (decorationType: string) => {
    const dt = catalog.decorationTypes.find((t: any) => t.name === decorationType)
    const deets = dt?.details || []
    onChange({
      ...decoration,
      decorationType,
      detail: deets.length === 1 ? deets[0] : '',
    })
  }

  return (
    <div className="bg-[rgb(var(--color-surface))] rounded-xl p-4 mb-3 border border-lime-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[rgb(var(--color-brand-blue))]">Decoration {index + 1}</span>
        {onRemove && (
          <button className="btn-ghost text-xs text-red-500" onClick={onRemove}>Remove</button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
          <select className="select-glass" value={decoration.decorationType} onChange={e => handleTypeChange(e.target.value)}>
            <option value="">Select...</option>
            {applicableTypes.map((dt: any) => <option key={dt.name} value={dt.name}>{dt.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Detail</label>
          <select
            className="select-glass"
            value={decoration.detail}
            onChange={e => onChange({ ...decoration, detail: e.target.value })}
            disabled={!decoration.decorationType}
          >
            <option value="">Select...</option>
            {details.map((d: string) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Location</label>
          <select
            className="select-glass"
            value={decoration.location}
            onChange={e => onChange({ ...decoration, location: e.target.value })}
          >
            <option value="">Select...</option>
            {catalog.decorationLocations.map((loc: any) => (
              <option key={loc.id} value={loc.name}>{loc.name}</option>
            ))}
          </select>
        </div>
      </div>

      <ArtworkUpload
        decoration={decoration}
        onChange={onChange}
        onOpenDesignPicker={onOpenDesignPicker}
        quoteSessionId={quoteSessionId}
        artworkUploadUrl={artworkUploadUrl}
      />
    </div>
  )
}
