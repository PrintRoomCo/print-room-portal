'use client'

import { useState } from 'react'

/** One size row of the item being split. */
export interface AllocationSizeLine {
  lineId: string
  sizeLabel: string | null
  qty: number
}

export interface AllocationDestination {
  ref: string
  label: string
}

/**
 * How many units of each cart line go to each destination.
 * Keyed lineId -> destinationRef -> qty. A missing key means "nothing here",
 * which is why zero is never written: it keeps the map the same shape as the
 * request body's `allocations`, so building that is a plain map with no lookup.
 */
export type AllocationMap = Record<string, Record<string, number>>

export function allocatedForLine(allocations: AllocationMap, lineId: string): number {
  return Object.values(allocations[lineId] ?? {}).reduce((total, qty) => total + qty, 0)
}

/** Positive = still to allocate, negative = over-allocated. */
export function remainingForLine(
  allocations: AllocationMap,
  lineId: string,
  qty: number,
): number {
  return qty - allocatedForLine(allocations, lineId)
}

interface AllocationGridProps {
  sizeLines: AllocationSizeLine[]
  destinations: AllocationDestination[]
  allocations: AllocationMap
  onChange: (next: AllocationMap) => void
  disabled?: boolean
}

const cellKey = (lineId: string, destinationRef: string) => `${lineId}:${destinationRef}`

export function AllocationGrid({
  sizeLines,
  destinations,
  allocations,
  onChange,
  disabled = false,
}: AllocationGridProps) {
  // Only the cell being edited keeps its raw string. That is what lets someone
  // type "1" on the way to "12" without the display fighting back, while every
  // other cell still renders straight from props so it can never go stale.
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null)

  function displayValue(lineId: string, destinationRef: string): string {
    const key = cellKey(lineId, destinationRef)
    if (editing?.key === key) return editing.value
    const qty = allocations[lineId]?.[destinationRef]
    return qty === undefined ? '' : String(qty)
  }

  function handleCellChange(lineId: string, destinationRef: string, raw: string) {
    setEditing({ key: cellKey(lineId, destinationRef), value: raw })

    const next: AllocationMap = { ...allocations, [lineId]: { ...(allocations[lineId] ?? {}) } }
    const trimmed = raw.trim()
    const parsed = Number(trimmed)
    if (trimmed === '' || !Number.isInteger(parsed) || parsed <= 0) {
      // An empty or not-yet-valid cell means "no allocation", never NaN leaking
      // into the sums. The server re-validates anyway.
      delete next[lineId][destinationRef]
    } else {
      next[lineId][destinationRef] = parsed
    }
    onChange(next)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500">
              Size
            </th>
            {destinations.map((destination) => (
              <th
                key={destination.ref}
                scope="col"
                className="px-2 py-2 text-left text-xs font-medium text-gray-500"
              >
                {destination.label}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-right text-xs font-medium text-gray-500">
              Remaining
            </th>
          </tr>
        </thead>
        <tbody>
          {sizeLines.map((sizeLine) => {
            const remaining = remainingForLine(allocations, sizeLine.lineId, sizeLine.qty)
            const label = sizeLine.sizeLabel ?? 'One size'
            return (
              <tr key={sizeLine.lineId}>
                <th scope="row" className="px-2 py-2 text-left font-medium text-gray-900">
                  {label}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {sizeLine.qty} total
                  </span>
                </th>
                {destinations.map((destination) => (
                  <td key={destination.ref} className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-label={`${label} to ${destination.label}`}
                      value={displayValue(sizeLine.lineId, destination.ref)}
                      onChange={(event) =>
                        handleCellChange(sizeLine.lineId, destination.ref, event.target.value)
                      }
                      onBlur={() => setEditing(null)}
                      disabled={disabled}
                      className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30 disabled:bg-gray-100"
                    />
                  </td>
                ))}
                <td
                  data-testid={`remaining-${sizeLine.lineId}`}
                  className={`px-2 py-2 text-right tabular-nums ${
                    remaining === 0
                      ? 'text-gray-500'
                      : remaining < 0
                        ? 'text-red-600'
                        : 'text-amber-600'
                  }`}
                >
                  {remaining < 0 ? `${-remaining} over` : `${remaining} left`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
