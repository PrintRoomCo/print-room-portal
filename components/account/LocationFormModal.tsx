'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import {
  createLocationAction,
  updateLocationAction,
  type ActionResult,
} from '@/app/(portal)/account/actions'
import { NZ_REGIONS, regionCodeFromState } from '@/lib/nz-regions'

// Just the fields the form reads/writes. A full Store passes structurally.
export interface LocationFormStore {
  id: string
  name: string
  address: string | null
  location: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  phone: string | null
}

interface LocationFormModalProps {
  mode: 'add' | 'edit'
  /** Required in edit mode; ignored in add mode. */
  store?: LocationFormStore | null
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
export function LocationFormModal({ mode, store, onClose, onSaved }: LocationFormModalProps) {
  const [result, setResult] = useState<ActionResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isEdit = mode === 'edit'

  // Pre-select the region from the stored state name. If it maps to nothing
  // known (legacy/free-text data), keep the raw value as a pass-through option
  // so saving round-trips it instead of nulling it out.
  const matchedRegionCode = isEdit ? regionCodeFromState(store?.state) : ''
  const unmatchedState = isEdit && store?.state && !matchedRegionCode ? store.state : null
  const defaultRegion = matchedRegionCode || unmatchedState || ''

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
                    <input
                      type="text"
                      id="address1"
                      name="address1"
                      defaultValue={isEdit ? store?.address ?? '' : ''}
                      placeholder="123 Main Street"
                      className="input-glass"
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
                        defaultValue={isEdit ? store?.city ?? '' : ''}
                        placeholder="Auckland"
                        className="input-glass"
                      />
                    </div>

                    <div>
                      <label htmlFor="regionCode" className="block text-sm font-medium text-gray-700 mb-1">
                        Region
                      </label>
                      <select
                        id="regionCode"
                        name="regionCode"
                        defaultValue={defaultRegion}
                        className="input-glass"
                      >
                        <option value="">Select region...</option>
                        {unmatchedState && <option value={unmatchedState}>{unmatchedState}</option>}
                        {NZ_REGIONS.map((region) => (
                          <option key={region.code} value={region.code}>
                            {region.name}
                          </option>
                        ))}
                      </select>
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
                      defaultValue={isEdit ? store?.postal_code ?? '' : ''}
                      placeholder="1010"
                      className="input-glass"
                    />
                  </div>
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
