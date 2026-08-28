'use client'

import { useState } from 'react'

import { removeDestination, type SplitShipmentState } from '@/lib/checkout/split-shipment-state'
import { AddressAutocompleteInput } from './AddressAutocompleteInput'
import type { CustomAddress } from './checkoutReviewState'
import type { StoreOption } from './ShipToRow'

const EMPTY_ADDRESS: CustomAddress = {
  name: '',
  address: '',
  city: '',
  postal_code: '',
  country: 'NZ',
}

const MANUAL_FIELDS = [
  ['name', 'Name'],
  ['address', 'Street address'],
  ['city', 'City'],
  ['postal_code', 'Postcode'],
  ['country', 'Country'],
] as const

export function destinationLabel(
  destination: SplitShipmentState['destinations'][number],
  stores: StoreOption[],
): string {
  if (destination.storeId) {
    const store = stores.find((candidate) => candidate.id === destination.storeId)
    return store?.name ?? 'Store'
  }
  return destination.customAddress?.name?.trim() || 'One-time address'
}

interface DestinationChipsProps {
  stores: StoreOption[]
  /** False for branch-scoped buyers: they ship only to granted branches. */
  allowCustom: boolean
  value: SplitShipmentState
  onChange: (next: SplitShipmentState) => void
  disabled?: boolean
}

/**
 * The whole destinations surface: a compact chip per destination, one editor
 * panel expanding beneath the row at a time, and the add control. Allocation
 * itself lives on the checkout line rows, not here.
 */
export function DestinationChips({
  stores,
  allowCustom,
  value,
  onChange,
  disabled = false,
}: DestinationChipsProps) {
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  // Refs whose address the customer chose to type in by hand. Autocomplete is
  // the default; this is the escape hatch, so a Places outage never blocks an
  // order.
  const [manualRefs, setManualRefs] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const unusedStores = stores.filter(
    (store) => !value.destinations.some((destination) => destination.storeId === store.id),
  )

  function addDestination(storeId: string | null) {
    const ref = crypto.randomUUID()
    setAddOpen(false)
    // A one-time address is unusable until it has been typed, so open its panel.
    setOpenRef(storeId ? null : ref)
    setNotice(null)
    onChange({
      ...value,
      destinations: [
        ...value.destinations,
        { ref, storeId, customAddress: storeId ? null : { ...EMPTY_ADDRESS } },
      ],
      defaultDestinationRef: value.defaultDestinationRef ?? ref,
    })
  }

  function patchDestination(
    ref: string,
    patch: Partial<SplitShipmentState['destinations'][number]>,
  ) {
    onChange({
      ...value,
      destinations: value.destinations.map((destination) =>
        destination.ref === ref ? { ...destination, ...patch } : destination,
      ),
    })
  }

  function handleRemove(ref: string) {
    const label = destinationLabel(
      value.destinations.find((destination) => destination.ref === ref)!,
      stores,
    )
    const { state: next, movedUnits } = removeDestination(value, ref)
    const fallback = next.destinations.find(
      (destination) => destination.ref === next.defaultDestinationRef,
    )
    setNotice(
      movedUnits > 0 && fallback
        ? `Removed ${label}. ${movedUnits} unit${movedUnits === 1 ? '' : 's'} now ship to ${destinationLabel(fallback, stores)}.`
        : `Removed ${label}.`,
    )
    if (openRef === ref) setOpenRef(null)
    onChange(next)
  }

  return (
    <div className="mt-4">
      <h3 className="text-right text-sm font-medium text-gray-900">Destinations</h3>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {value.destinations.map((destination) => {
          const label = destinationLabel(destination, stores)
          const isDefault = value.defaultDestinationRef === destination.ref
          return (
            <span
              key={destination.ref}
              className={`flex items-center gap-1 rounded-full border px-1 py-0.5 text-sm ${
                isDefault ? 'border-gray-900 bg-gray-900/5' : 'border-gray-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenRef(openRef === destination.ref ? null : destination.ref)}
                aria-expanded={openRef === destination.ref}
                disabled={disabled}
                className="rounded-full px-2 py-0.5 text-gray-900 hover:bg-gray-100"
              >
                {isDefault && <span className="sr-only">Default: </span>}
                {isDefault && (
                  <span aria-hidden="true" className="mr-1 text-gray-900">
                    ★
                  </span>
                )}
                {label}
              </button>
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() => handleRemove(destination.ref)}
                disabled={disabled}
                className="rounded-full px-1.5 py-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          )
        })}

        {(unusedStores.length > 0 || allowCustom) && (
          <button
            type="button"
            onClick={() => setAddOpen((open) => !open)}
            aria-expanded={addOpen}
            disabled={disabled}
            className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-900"
          >
            + Add
          </button>
        )}
      </div>

      {addOpen && (
        <ul className="ml-auto mt-2 w-full max-w-xs rounded-xl border border-gray-100 bg-white p-1 text-sm shadow-sm">
          {unusedStores.map((store) => (
            <li key={store.id}>
              <button
                type="button"
                onClick={() => addDestination(store.id)}
                disabled={disabled}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50"
              >
                {store.name ?? 'Store'}
                {store.city ? `, ${store.city}` : ''}
              </button>
            </li>
          ))}
          {allowCustom && (
            <li>
              <button
                type="button"
                onClick={() => addDestination(null)}
                disabled={disabled}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50"
              >
                One-time address
              </button>
            </li>
          )}
        </ul>
      )}

      {value.destinations.map((destination) => {
        if (openRef !== destination.ref) return null
        const label = destinationLabel(destination, stores)
        const isDefault = value.defaultDestinationRef === destination.ref
        const manual = manualRefs.includes(destination.ref)
        return (
          <div
            key={destination.ref}
            className="mt-3 rounded-xl border border-gray-100 bg-white p-3 text-sm"
          >
            {destination.storeId ? (
              <label className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Store</span>
                <select
                  aria-label={`Store for ${label}`}
                  value={destination.storeId}
                  onChange={(event) =>
                    patchDestination(destination.ref, { storeId: event.target.value })
                  }
                  disabled={disabled}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                >
                  {stores
                    .filter(
                      (store) =>
                        store.id === destination.storeId ||
                        unusedStores.some((unused) => unused.id === store.id),
                    )
                    .map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name ?? 'Store'}
                        {store.city ? `, ${store.city}` : ''}
                      </option>
                    ))}
                </select>
              </label>
            ) : manual ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {MANUAL_FIELDS.map(([field, fieldLabel]) => (
                  <label key={field} className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">{fieldLabel}</span>
                    <input
                      type="text"
                      aria-label={`${fieldLabel} for one-time destination`}
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
            ) : (
              <div>
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

            <div className="mt-3 flex items-center gap-3">
              {!isDefault && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...value, defaultDestinationRef: destination.ref })
                  }
                  disabled={disabled}
                  className="text-xs text-gray-500 underline hover:text-gray-900"
                >
                  Make {label} the default
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpenRef(null)}
                className="ml-auto rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-900 hover:bg-gray-50"
              >
                Done
              </button>
            </div>
          </div>
        )
      })}

      {notice && (
        <p role="status" className="mt-3 text-right text-xs text-amber-700">
          {notice}
        </p>
      )}
    </div>
  )
}
