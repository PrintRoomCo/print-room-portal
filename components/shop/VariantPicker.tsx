'use client'

import * as ToggleGroup from '@radix-ui/react-toggle-group'
import type { VariantAvailability } from '@/lib/shop/variant-availability'

export interface VariantRow {
  variant_id: string
  color_swatch_id: string | null
  color_label: string | null
  color_hex: string | null
  color_position: number
  catalogue_color_sort_order?: number | null
  catalogue_color_is_default?: boolean
  size_id: number | null
  size_label: string | null
  size_order: number
}

export interface ColourOption {
  id: string
  label: string | null
  hex: string | null
  position: number
  catalogueSortOrder: number | null
  isDefault: boolean
}

interface VariantPickerProps {
  variants: VariantRow[]
  colorOptions?: ColourOption[]
  selectedColorSwatchId: string | null
  selectedSizeId: number | null
  onChange: (next: { colorSwatchId: string | null; sizeId: number | null }) => void
  availability?: Record<string, VariantAvailability>
  showSizePicker?: boolean
}

export function VariantPicker({
  variants,
  colorOptions,
  selectedColorSwatchId,
  selectedSizeId,
  onChange,
  availability,
  showSizePicker = true,
}: VariantPickerProps) {
  const colorMap = new Map<string, ColourOption>()
  const addColor = (c: ColourOption) => {
    if (!colorMap.has(c.id)) colorMap.set(c.id, c)
  }

  if (colorOptions && colorOptions.length > 0) {
    for (const color of colorOptions) addColor(color)
  } else {
    for (const v of variants) {
      if (!v.color_swatch_id) continue
      addColor({
        id: v.color_swatch_id,
        label: v.color_label,
        hex: v.color_hex,
        position: v.color_position,
        catalogueSortOrder: v.catalogue_color_sort_order ?? null,
        isDefault: v.catalogue_color_is_default === true,
      })
    }
  }
  const colors = Array.from(colorMap.values()).sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    const as = a.catalogueSortOrder ?? a.position
    const bs = b.catalogueSortOrder ?? b.position
    return as - bs
  })

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
          <ToggleGroup.Root
            type="single"
            value={selectedColorSwatchId ?? undefined}
            onValueChange={(next) => {
              if (next) onChange({ colorSwatchId: next, sizeId: selectedSizeId })
            }}
            aria-label="Select colour"
            className="flex flex-wrap gap-2"
          >
            {colors.map((c) => {
              const isSelected = c.id === selectedColorSwatchId
              return (
                <ToggleGroup.Item
                  key={c.id}
                  value={c.id}
                  title={c.label ?? ''}
                  aria-label={`Select colour ${c.label ?? ''}`}
                  className={`h-9 w-9 rounded-full border-2 transition-all duration-200 ease-spring ${
                    isSelected
                      ? 'border-pr-blue ring-2 ring-pr-blue/30'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                  style={{ backgroundColor: c.hex ?? '#fff' }}
                />
              )
            })}
          </ToggleGroup.Root>
        </div>
      )}

      {showSizePicker && sizes.length > 0 && (
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-900">Size</label>
          <ToggleGroup.Root
            type="single"
            value={selectedSizeId == null ? undefined : String(selectedSizeId)}
            onValueChange={(next) => {
              if (next) {
                onChange({ colorSwatchId: selectedColorSwatchId, sizeId: Number(next) })
              }
            }}
            aria-label="Select size"
            className="flex flex-wrap gap-2"
          >
            {sizes.map((s) => {
              const isSelected = s.id === selectedSizeId
              const variantForSize = variants.find(
                (v) =>
                  v.color_swatch_id === selectedColorSwatchId && v.size_id === s.id,
              )
              const avail =
                variantForSize != null && availability != null
                  ? availability[variantForSize.variant_id]
                  : undefined
              const tracked = avail !== undefined
              const qty = tracked ? avail.available_qty : null
              const outOfStock = tracked && (qty ?? 0) === 0
              const backorderable = tracked && avail.allow_order_without_stock
              const showBackorderableChip = outOfStock && backorderable
              // Backorderable cells should still feel interactive even when
              // stocked === 0 — don't apply the muted/gray treatment that
              // signals "unorderable" in the stocked-only path.
              const mutedOutOfStock = outOfStock && !backorderable
              return (
                <ToggleGroup.Item
                  key={s.id}
                  value={String(s.id)}
                  className={`flex flex-col items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-200 ease-spring ${
                    isSelected
                      ? 'border-pr-blue bg-pr-blue text-white'
                      : mutedOutOfStock
                        ? 'border-gray-200 bg-gray-50 text-gray-400'
                        : 'border-gray-200 bg-white text-gray-800 hover:border-gray-400'
                  }`}
                >
                  <span>{s.label}</span>
                  {tracked && (
                    showBackorderableChip ? (
                      <span className="mt-0.5 inline-flex rounded-full bg-[rgb(var(--accent-mint))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--accent-mint-ink))]">
                        Available to order
                      </span>
                    ) : (
                      <span
                        className={`mt-0.5 text-[10px] font-normal ${
                          isSelected
                            ? 'text-white/80'
                            : mutedOutOfStock
                              ? 'text-gray-400'
                              : (qty ?? 0) <= 5
                                ? 'text-amber-600'
                                : 'text-gray-500'
                        }`}
                      >
                        {outOfStock ? '0 in stock' : `${qty} in stock`}
                      </span>
                    )
                  )}
                </ToggleGroup.Item>
              )
            })}
          </ToggleGroup.Root>
        </div>
      )}
    </div>
  )
}
