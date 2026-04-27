'use client'

import { useEffect, useState } from 'react'
import {
  getItemColorName,
  getItemDesignName,
  getItemDisplayName,
  type QuoteDataItem,
} from '@/lib/job-tracker'
import {
  REORDER_EDITABLE_LINE_ITEMS,
  type ReorderEditedItem,
} from '@/lib/config/reorder'
import { ProjectLineItem } from './ProjectLineItem'

interface EditableReorderItemsProps {
  items: QuoteDataItem[]
  designNamesByInstanceId?: Record<string, string>
  onChange: (edited: ReorderEditedItem[]) => void
  disabled?: boolean
}

function seedFromSource(
  items: QuoteDataItem[],
  designNamesByInstanceId?: Record<string, string>,
): ReorderEditedItem[] {
  return items.map((item, index) => {
    const productName = getItemDisplayName(item)
    const color = getItemColorName(item)
    const sizes: Record<string, number> = {}
    if (item.sizes) {
      for (const [k, v] of Object.entries(item.sizes)) {
        if ((v ?? 0) > 0) sizes[k] = v as number
      }
    }
    return {
      source_index: index,
      product_name: productName,
      color: color || null,
      sizes,
      included: true,
    }
  })
}

export function EditableReorderItems({
  items,
  designNamesByInstanceId,
  onChange,
  disabled,
}: EditableReorderItemsProps) {
  const [edited, setEdited] = useState<ReorderEditedItem[]>(() =>
    seedFromSource(items, designNamesByInstanceId),
  )

  useEffect(() => {
    onChange(edited)
  }, [edited, onChange])

  if (!REORDER_EDITABLE_LINE_ITEMS) {
    return (
      <div className="space-y-2">
        {items.map((item, index) => (
          <ProjectLineItem
            key={`${item.productId || item.productName || 'item'}-${index}`}
            item={item}
            designNamesByInstanceId={designNamesByInstanceId}
          />
        ))}
      </div>
    )
  }

  function patchItem(index: number, patch: Partial<ReorderEditedItem>) {
    setEdited((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    )
  }

  function setSize(index: number, label: string, qty: number) {
    setEdited((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        const sizes = { ...it.sizes }
        if (qty <= 0) {
          delete sizes[label]
        } else {
          sizes[label] = qty
        }
        return { ...it, sizes }
      }),
    )
  }

  function renameSize(index: number, oldLabel: string, newLabel: string) {
    if (oldLabel === newLabel) return
    setEdited((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        const sizes: Record<string, number> = {}
        for (const [k, v] of Object.entries(it.sizes)) {
          sizes[k === oldLabel ? newLabel : k] = v
        }
        return { ...it, sizes }
      }),
    )
  }

  function addSize(index: number) {
    setEdited((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        let label = 'New'
        let n = 1
        while (label in it.sizes) {
          n += 1
          label = `New${n}`
        }
        return { ...it, sizes: { ...it.sizes, [label]: 1 } }
      }),
    )
  }

  return (
    <div className="space-y-3">
      {edited.map((row, index) => {
        const item = items[index]
        const designName = item
          ? getItemDesignName(item, designNamesByInstanceId)
          : 'Item'
        return (
          <fieldset
            key={index}
            className={`rounded-2xl border p-4 transition-opacity ${
              row.included
                ? 'border-gray-200 bg-white'
                : 'border-gray-100 bg-gray-50 opacity-60'
            }`}
            disabled={disabled}
          >
            <legend className="px-2 text-sm font-semibold text-gray-900">
              {designName}
            </legend>

            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={row.included}
                onChange={(e) =>
                  patchItem(index, { included: e.target.checked })
                }
              />
              Include in reorder
            </label>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs text-gray-600">
                Product name
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                  defaultValue={row.product_name}
                  onBlur={(e) =>
                    patchItem(index, {
                      product_name: e.target.value.slice(0, 200),
                    })
                  }
                />
              </label>
              <label className="block text-xs text-gray-600">
                Colour
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                  defaultValue={row.color ?? ''}
                  onBlur={(e) =>
                    patchItem(index, {
                      color: e.target.value.trim()
                        ? e.target.value.slice(0, 100)
                        : null,
                    })
                  }
                />
              </label>
            </div>

            <div className="mt-3">
              <p className="text-xs text-gray-600">Sizes</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(row.sizes).map(([label, qty]) => (
                  <div
                    key={label}
                    className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs"
                  >
                    <input
                      aria-label="Size label"
                      className="w-12 bg-transparent text-xs outline-none"
                      defaultValue={label}
                      onBlur={(e) => {
                        const next = e.target.value.trim().slice(0, 16)
                        if (next && next !== label) {
                          renameSize(index, label, next)
                        }
                      }}
                    />
                    <span className="text-gray-400">:</span>
                    <input
                      aria-label="Size quantity"
                      type="number"
                      min={0}
                      className="w-14 bg-transparent text-xs outline-none"
                      defaultValue={qty}
                      onBlur={(e) =>
                        setSize(
                          index,
                          label,
                          Math.max(0, Math.min(100_000, Number(e.target.value) || 0)),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove size ${label}`}
                      onClick={() => setSize(index, label, 0)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="rounded-md border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-gray-400"
                  onClick={() => addSize(index)}
                >
                  + Add size
                </button>
              </div>
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
