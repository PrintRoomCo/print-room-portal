'use client'

import { useMemo, useState } from 'react'

import {
  buildDestinationInputs,
  isItemSplit,
  itemKey,
  removeDestination,
  type EditorCartLine,
  type SplitShipmentState,
} from '@/lib/checkout/split-shipment-state'
import { AddressAutocompleteInput } from './AddressAutocompleteInput'
import { AllocationGrid, type AllocationDestination } from './AllocationGrid'
import type { CustomAddress } from './checkoutReviewState'
import type { StoreOption } from './ShipToRow'

export interface EditorLine extends EditorCartLine {
  productName: string
  variantLabel: string | null
  sizeLabel: string | null
}

interface SplitShipmentEditorProps {
  lines: EditorLine[]
  stores: StoreOption[]
  /** False for branch-scoped buyers: they ship only to granted branches. */
  allowCustom: boolean
  value: SplitShipmentState
  onChange: (next: SplitShipmentState) => void
  disabled?: boolean
}

const EMPTY_ADDRESS: CustomAddress = {
  name: '',
  address: '',
  city: '',
  postal_code: '',
  country: 'NZ',
}

function destinationLabel(
  destination: SplitShipmentState['destinations'][number],
  stores: StoreOption[],
): string {
  if (destination.storeId) {
    const store = stores.find((candidate) => candidate.id === destination.storeId)
    return store?.name ?? 'Store'
  }
  return destination.customAddress?.name?.trim() || 'One-time address'
}

export function SplitShipmentEditor({
  lines,
  stores,
  allowCustom,
  value,
  onChange,
  disabled = false,
}: SplitShipmentEditorProps) {
  const [notice, setNotice] = useState<string | null>(null)
  // Refs whose address the customer chose to type in by hand. Autocomplete is
  // the default; this is the escape hatch, so a Places outage never blocks an
  // order.
  const [manualRefs, setManualRefs] = useState<string[]>([])

  // Grouped by product + colourway: the grid's rows are that item's sizes.
  const items = useMemo(() => {
    const grouped = new Map<string, { key: string; title: string; lines: EditorLine[] }>()
    for (const line of lines) {
      const key = itemKey(line.productId, line.variantId)
      const existing = grouped.get(key)
      if (existing) existing.lines.push(line)
      else {
        grouped.set(key, {
          key,
          title: [line.productName, line.variantLabel].filter(Boolean).join(' / '),
          lines: [line],
        })
      }
    }
    return [...grouped.values()]
  }, [lines])

  const gridDestinations: AllocationDestination[] = value.destinations.map((destination) => ({
    ref: destination.ref,
    label: destinationLabel(destination, stores),
  }))

  function addDestination(storeId: string | null) {
    const ref = crypto.randomUUID()
    onChange({
      ...value,
      destinations: [
        ...value.destinations,
        { ref, storeId, customAddress: storeId ? null : { ...EMPTY_ADDRESS } },
      ],
      defaultDestinationRef: value.defaultDestinationRef ?? ref,
    })
  }

  function handleRemove(ref: string) {
    const { state: next, discardedUnits } = removeDestination(value, ref)
    setNotice(
      discardedUnits > 0
        ? `Removed a destination and released ${discardedUnits} unit${discardedUnits === 1 ? '' : 's'}. Re-allocate them before checking out.`
        : null,
    )
    onChange(next)
  }

  function patchDestination(ref: string, patch: Partial<SplitShipmentState['destinations'][number]>) {
    onChange({
      ...value,
      destinations: value.destinations.map((destination) =>
        destination.ref === ref ? { ...destination, ...patch } : destination,
      ),
    })
  }

  function toggleItemSplit(key: string) {
    const nextKeys = isItemSplit(value, key)
      ? value.splitItemKeys.filter((candidate) => candidate !== key)
      : [...value.splitItemKeys, key]
    // Dropping an item out of split mode clears its allocations: it now ships
    // whole to the default, and leftover numbers would silently disagree.
    const allocations = { ...value.allocations }
    if (!nextKeys.includes(key)) {
      for (const line of lines) {
        if (itemKey(line.productId, line.variantId) === key) delete allocations[line.lineId]
      }
    }
    onChange({ ...value, splitItemKeys: nextKeys, allocations })
  }

  const unusedStores = stores.filter(
    (store) => !value.destinations.some((destination) => destination.storeId === store.id),
  )

  return (
    <div className="mt-4 space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-900">Destinations</h3>
        <p className="mt-1 text-xs text-gray-500">
          Items you do not split are sent whole to the default destination.
        </p>

        <ul className="mt-3 space-y-3">
          {value.destinations.map((destination) => (
            <li
              key={destination.ref}
              className="rounded-xl border border-gray-100 bg-white p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="split-default-destination"
                    aria-label={`Make ${destinationLabel(destination, stores)} the default destination`}
                    checked={value.defaultDestinationRef === destination.ref}
                    onChange={() => onChange({ ...value, defaultDestinationRef: destination.ref })}
                    disabled={disabled}
                  />
                  <span className="text-xs text-gray-500">Default</span>
                </label>

                {destination.storeId ? (
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Store</span>
                    <select
                      aria-label={`Store for destination ${destinationLabel(destination, stores)}`}
                      value={destination.storeId}
                      onChange={(event) =>
                        patchDestination(destination.ref, { storeId: event.target.value })
                      }
                      disabled={disabled}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                    >
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name ?? 'Store'}
                          {store.city ? `, ${store.city}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="text-sm font-medium text-gray-900">
                    {destinationLabel(destination, stores)}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => handleRemove(destination.ref)}
                  disabled={disabled}
                  className="ml-auto text-xs text-gray-500 underline hover:text-gray-900"
                >
                  Remove
                </button>
              </div>

              {!destination.storeId && !manualRefs.includes(destination.ref) && (
                <div className="mt-3">
                  <AddressAutocompleteInput
                    name={destination.customAddress?.name ?? ''}
                    countryBias={destination.customAddress?.country ?? null}
                    onResolved={(address) =>
                      patchDestination(destination.ref, { customAddress: address })
                    }
                    onManualEntry={() =>
                      setManualRefs((previous) =>
                        previous.includes(destination.ref)
                          ? previous
                          : [...previous, destination.ref],
                      )
                    }
                    disabled={disabled}
                  />
                  {destination.customAddress?.address && (
                    <p className="mt-2 text-xs text-gray-500">
                      {[
                        destination.customAddress.address,
                        destination.customAddress.city,
                        destination.customAddress.postal_code,
                        destination.customAddress.country,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  )}
                </div>
              )}

              {!destination.storeId && manualRefs.includes(destination.ref) && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['name', 'Name'],
                      ['address', 'Street address'],
                      ['city', 'City'],
                      ['postal_code', 'Postcode'],
                      ['country', 'Country'],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">{label}</span>
                      <input
                        type="text"
                        aria-label={`${label} for one-time destination`}
                        value={destination.customAddress?.[field] ?? ''}
                        onChange={(event) =>
                          patchDestination(destination.ref, {
                            customAddress: {
                              ...(destination.customAddress ?? EMPTY_ADDRESS),
                              [field]: event.target.value,
                            },
                          })
                        }
                        disabled={disabled}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                      />
                    </label>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          {unusedStores.length > 0 && (
            <button
              type="button"
              onClick={() => addDestination(unusedStores[0].id)}
              disabled={disabled}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-900 hover:bg-gray-50"
            >
              Add a saved store
            </button>
          )}
          {allowCustom && (
            <button
              type="button"
              onClick={() => addDestination(null)}
              disabled={disabled}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-900 hover:bg-gray-50"
            >
              Add a one-time address
            </button>
          )}
        </div>

        {notice && (
          <p role="status" className="mt-3 text-xs text-amber-700">
            {notice}
          </p>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-900">Items</h3>
        {items.map((item) => (
          <div key={item.key} className="rounded-xl border border-gray-100 bg-white p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Split ${item.title} across destinations`}
                checked={isItemSplit(value, item.key)}
                onChange={() => toggleItemSplit(item.key)}
                disabled={disabled || value.destinations.length === 0}
              />
              <span className="text-sm font-medium text-gray-900">{item.title}</span>
              <span className="text-xs text-gray-500">Split across destinations</span>
            </label>

            {isItemSplit(value, item.key) && value.destinations.length > 0 && (
              <div className="mt-3">
                <AllocationGrid
                  sizeLines={item.lines.map((line) => ({
                    lineId: line.lineId,
                    sizeLabel: line.sizeLabel,
                    qty: line.qty,
                  }))}
                  destinations={gridDestinations}
                  allocations={value.allocations}
                  onChange={(allocations) => onChange({ ...value, allocations })}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export { buildDestinationInputs }
