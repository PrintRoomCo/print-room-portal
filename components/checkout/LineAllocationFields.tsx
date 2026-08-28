'use client'

import { useState } from 'react'

import {
  remainingForLine,
  type AllocationDestination,
  type AllocationMap,
} from '@/lib/checkout/allocation'

interface LineAllocationFieldsProps {
  lineId: string
  /** Reads back in every input's accessible name, e.g. "Everyday Pullover Hoodie Navy / S". */
  lineLabel: string
  qty: number
  destinations: AllocationDestination[]
  /** Where this line goes while the customer has said nothing about it. */
  defaultDestinationLabel: string | null
  allocations: AllocationMap
  onChange: (next: AllocationMap) => void
  disabled?: boolean
}

/**
 * One cart line's split allocation, rendered under that line's checkout row.
 * A line with no entries is not a line in limbo: it ships whole to the default,
 * which is why the status cell names the default rather than counting units.
 */
export function LineAllocationFields({
  lineId,
  lineLabel,
  qty,
  destinations,
  defaultDestinationLabel,
  allocations,
  onChange,
  disabled = false,
}: LineAllocationFieldsProps) {
  // Only the field being edited keeps its raw string. That is what lets someone
  // type "1" on the way to "12" without the display fighting back, while every
  // other field still renders straight from props so it can never go stale.
  const [editing, setEditing] = useState<{ ref: string; value: string } | null>(null)

  if (destinations.length === 0) {
    return (
      <p className="text-xs text-gray-500">Add a destination above to split this line.</p>
    )
  }

  const perDestination = allocations[lineId] ?? {}
  const untouched = Object.keys(perDestination).length === 0
  const remaining = remainingForLine(allocations, lineId, qty)

  function displayValue(destinationRef: string): string {
    if (editing?.ref === destinationRef) return editing.value
    const value = perDestination[destinationRef]
    return value === undefined ? '' : String(value)
  }

  function handleChange(destinationRef: string, raw: string) {
    setEditing({ ref: destinationRef, value: raw })

    const next: AllocationMap = { ...allocations, [lineId]: { ...perDestination } }
    const trimmed = raw.trim()
    const parsed = Number(trimmed)
    if (trimmed === '' || !Number.isInteger(parsed) || parsed <= 0) {
      // An empty or not-yet-valid field means "no allocation", never NaN leaking
      // into the sums. The server re-validates anyway.
      delete next[lineId][destinationRef]
    } else {
      next[lineId][destinationRef] = parsed
    }
    if (Object.keys(next[lineId]).length === 0) delete next[lineId]
    onChange(next)
  }

  const status = untouched
    ? { text: `→ ${defaultDestinationLabel ?? 'default destination'}`, tone: 'text-gray-500' }
    : remaining < 0
      ? { text: `${-remaining} over`, tone: 'text-red-600' }
      : remaining === 0
        ? { text: '0 left', tone: 'text-gray-500' }
        : { text: `${remaining} left`, tone: 'text-amber-600' }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {destinations.map((destination) => (
        <label key={destination.ref} className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{destination.label}</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={`${lineLabel} to ${destination.label}`}
            value={displayValue(destination.ref)}
            onChange={(event) => handleChange(destination.ref, event.target.value)}
            onBlur={() => setEditing(null)}
            disabled={disabled}
            className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30 disabled:bg-gray-100"
          />
        </label>
      ))}
      <span
        data-testid={`remaining-${lineId}`}
        className={`text-xs tabular-nums ${status.tone}`}
      >
        {status.text}
      </span>
    </div>
  )
}
