'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import {
  createLocationAction,
  updateLocationAction,
  type ActionResult,
} from '@/app/(portal)/account/actions'
import { NZ_REGIONS } from '@/lib/nz-regions'
import {
  AddressAutocompleteInput,
  type AddressPlace,
} from '@/components/account/AddressAutocompleteInput'
import type { EnabledCountry } from '@/lib/account/org-countries'

// Just the fields the form reads/writes. A full Store passes structurally.
export interface LocationFormStore {
  id: string
  name: string
  address: string | null
  location: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
  phone: string | null
}

interface LocationFormModalProps {
  mode: 'add' | 'edit'
  /** Required in edit mode; ignored in add mode. */
  store?: LocationFormStore | null
  /** The org's enabled countries — the only values this form may write. */
  enabledCountries: EnabledCountry[]
  onClose: () => void
  /** Fired after a successful save so the parent can refetch. */
  onSaved: () => void
}

/**
 * Add/edit modal for an organisation location. Both flows share the same seven
 * fields; edit mode pre-fills them from `store` and posts a hidden storeId to
 * updateLocationAction. Rendered only while open (parent conditionally mounts
 * it), so each open starts with fresh state.
 */
export function LocationFormModal({
  mode,
  store,
  enabledCountries,
  onClose,
  onSaved,
}: LocationFormModalProps) {
  const [result, setResult] = useState<ActionResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isEdit = mode === 'edit'

  // The four address fields are controlled because Geoapify writes into them;
  // their `name` attributes are unchanged, so FormData submission is the same.
  const [address1, setAddress1] = useState(isEdit ? store?.address ?? '' : '')
  const [city, setCity] = useState(isEdit ? store?.city ?? '' : '')
  const [stateField, setStateField] = useState(isEdit ? store?.state ?? '' : '')
  const [zip, setZip] = useState(isEdit ? store?.postal_code ?? '' : '')
  const defaultCountry = enabledCountries.find((c) => c.isDefault)?.code ?? enabledCountries[0]?.code ?? 'NZ'
  const [country, setCountry] = useState(isEdit ? store?.country ?? defaultCountry : defaultCountry)
  const singleCountry = enabledCountries.length <= 1

  function handlePlace(place: AddressPlace) {
    if (place.address) setAddress1(place.address)
    if (place.city) setCity(place.city)
    if (place.state) setStateField(place.state)
    if (place.postal_code) setZip(place.postal_code)
    if (place.country && enabledCountries.some((c) => c.code === place.country)) {
      setCountry(place.country)
    }
  }

  // On success, show the confirmation briefly, then refetch + close.
  useEffect(() => {
    if (!result?.success) return
    const timer = setTimeout(() => {
      onSaved()
      onClose()
    }, 1200)
    return () => clearTimeout(timer)
  }, [result, onSaved, onClose])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setResult(null)
    const formData = new FormData(e.currentTarget)
    const action = isEdit ? updateLocationAction : createLocationAction
    const res = await action(formData)
    setResult(res)
    setSubmitting(false)
  }

  const title = isEdit ? 'Edit Location' : 'Add New Location'
  const submitLabel = submitting
    ? isEdit
      ? 'Saving...'
      : 'Creating...'
    : isEdit
      ? 'Save Changes'
      : 'Create Location'

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="glass-modal-backdrop" />
        <Dialog.Content className="glass-modal-content fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-xl font-bold text-gray-900">{title}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Close modal"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </Dialog.Close>
            </div>

            {result?.success && (
              <div className="glass-success-box p-3 mb-4">
                <p className="text-sm">{result.message}</p>
              </div>
            )}

            {result?.errors && (
              <div className="glass-error-box p-3 mb-4">
                {result.errors.map((error, i) => (
                  <p key={i} className="text-sm">{error}</p>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {isEdit && store && <input type="hidden" name="storeId" value={store.id} />}

              <div>
                <label htmlFor="storeName" className="block text-sm font-medium text-gray-700 mb-1">
                  Location Name *
                </label>
                <input
                  type="text"
                  id="storeName"
                  name="storeName"
                  required
                  defaultValue={isEdit ? store?.name ?? '' : ''}
                  placeholder="e.g., Auckland Downtown"
                  className="input-glass"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  defaultValue={isEdit ? store?.phone ?? '' : ''}
                  placeholder="e.g., 09 123 4567 or 021 123 4567"
                  className="input-glass"
                />
                <p className="text-xs text-gray-500 mt-1">NZ numbers will be formatted automatically</p>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Shipping Address</h3>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="address1" className="block text-sm font-medium text-gray-700 mb-1">
                      Street Address
                    </label>
                    <AddressAutocompleteInput
                      id="address1"
                      name="address1"
                      value={address1}
                      onChange={setAddress1}
                      onPlace={handlePlace}
                      placeholder="123 Main Street"
                    />
                  </div>

                  <div>
                    <label htmlFor="address2" className="block text-sm font-medium text-gray-700 mb-1">
                      Unit / Suite (optional)
                    </label>
                    <input
                      type="text"
                      id="address2"
                      name="address2"
                      defaultValue={isEdit ? store?.location ?? '' : ''}
                      placeholder="Suite 100"
                      className="input-glass"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        id="city"
                        name="city"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Auckland"
                        className="input-glass"
                      />
                    </div>

                    <div>
                      <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-1">
                        Region / State
                      </label>
                      <input
                        type="text"
                        id="state"
                        name="state"
                        value={stateField}
                        onChange={(e) => setStateField(e.target.value)}
                        list={country === 'NZ' ? 'nz-region-suggestions' : undefined}
                        placeholder={country === 'NZ' ? 'e.g. Auckland' : ''}
                        className="input-glass"
                      />
                      {country === 'NZ' && (
                        <datalist id="nz-region-suggestions">
                          {NZ_REGIONS.map((region) => (
                            <option key={region.code} value={region.name} />
                          ))}
                        </datalist>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="zip" className="block text-sm font-medium text-gray-700 mb-1">
                      Postal Code
                    </label>
                    <input
                      type="text"
                      id="zip"
                      name="zip"
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      placeholder="1010"
                      className="input-glass"
                    />
                  </div>

                  {singleCountry ? (
                    <input type="hidden" name="country" value={country} />
                  ) : (
                    <div>
                      <label htmlFor="country" className="block text-sm font-medium text-gray-700 mb-1">
                        Country
                      </label>
                      <select
                        id="country"
                        name="country"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="input-glass"
                      >
                        {enabledCountries.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                            {c.isDefault ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Dialog.Close asChild>
                  <button type="button" className="flex-1 btn-secondary">
                    Cancel
                  </button>
                </Dialog.Close>
                <button type="submit" disabled={submitting} className="flex-1 btn-primary">
                  {submitLabel}
                </button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
