'use client'

export interface VariantRow {
  variant_id: string
  color_swatch_id: string | null
  color_label: string | null
  color_hex: string | null
  color_position: number
  size_id: number | null
  size_label: string | null
  size_order: number
}

interface VariantPickerProps {
  variants: VariantRow[]
  selectedColorSwatchId: string | null
  selectedSizeId: number | null
  onChange: (next: { colorSwatchId: string | null; sizeId: number | null }) => void
}

export function VariantPicker({
  variants,
  selectedColorSwatchId,
  selectedSizeId,
  onChange,
}: VariantPickerProps) {
  const colorMap = new Map<
    string,
    { id: string; label: string | null; hex: string | null; position: number }
  >()
  for (const v of variants) {
    if (!v.color_swatch_id) continue
    if (!colorMap.has(v.color_swatch_id)) {
      colorMap.set(v.color_swatch_id, {
        id: v.color_swatch_id,
        label: v.color_label,
        hex: v.color_hex,
        position: v.color_position,
      })
    }
  }
  const colors = Array.from(colorMap.values()).sort((a, b) => a.position - b.position)

  const sizeMap = new Map<number, { id: number; label: string | null; order: number }>()
  for (const v of variants) {
    if (v.size_id == null) continue
    if (!sizeMap.has(v.size_id)) {
      sizeMap.set(v.size_id, {
        id: v.size_id,
        label: v.size_label,
        order: v.size_order,
      })
    }
  }
  const sizes = Array.from(sizeMap.values()).sort((a, b) => a.order - b.order)

  const selectedColor = colors.find((c) => c.id === selectedColorSwatchId) ?? null

  return (
    <div className="space-y-4">
      {colors.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-900">Colour</label>
            {selectedColor?.label && (
              <span className="text-sm text-gray-600">{selectedColor.label}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const isSelected = c.id === selectedColorSwatchId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange({ colorSwatchId: c.id, sizeId: selectedSizeId })}
                  title={c.label ?? ''}
                  aria-label={`Select colour ${c.label ?? ''}`}
                  aria-pressed={isSelected}
                  className={`h-9 w-9 rounded-full border-2 transition-all duration-200 ease-spring ${
                    isSelected
                      ? 'border-pr-blue ring-2 ring-pr-blue/30'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                  style={{ backgroundColor: c.hex ?? '#fff' }}
                />
              )
            })}
          </div>
        </div>
      )}

      {sizes.length > 0 && (
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-900">Size</label>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => {
              const isSelected = s.id === selectedSizeId
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChange({ colorSwatchId: selectedColorSwatchId, sizeId: s.id })}
                  aria-pressed={isSelected}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-200 ease-spring ${
                    isSelected
                      ? 'border-pr-blue bg-pr-blue text-white'
                      : 'border-gray-200 bg-white text-gray-800 hover:border-gray-400'
                  }`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
