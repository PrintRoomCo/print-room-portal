'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCompany } from '@/contexts/CompanyContext'
import { getPortalOwnerKey } from '@/lib/portal-owner'
import { SetTopBarContext } from '@/components/layout/PortalTopBarContext'
import {
  updateCollectionAction,
  deleteCollectionAction,
  submitCollectionAction,
  reviseCollectionAction,
  addDesignAction,
  removeDesignAction,
} from './actions'
import type { CollectionWithDesigns, DesignSubmission } from '@/lib/collections'
import type { JobTracker } from '@/lib/job-tracker'
import { getPortalTrackerPath } from '@/lib/job-tracker'

interface Quote {
  id: string
  reference: string | null
  quote_number: string | null
  status: string
  customer_name: string | null
  customer_email: string
  customer_company: string | null
  subtotal: number
  decoration_cost: number | null
  shipping_estimate: number | null
  total_amount: number
  currency: string
  line_items: any[]
  notes: string | null
  created_at: string
}

function formatMoney(value: number, currency = 'NZD'): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Number(value || 0))
}

export default function CollectionDetail() {
  const { access, loading: companyLoading } = useCompany()
  const router = useRouter()
  const params = useParams<{ collectionId: string }>()
  const currentOwnerKey = getPortalOwnerKey(access)
  const [mode, setMode] = useState<'collection' | 'quote' | null>(null)
  const [collection, setCollection] = useState<CollectionWithDesigns | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [linkedCollection, setLinkedCollection] = useState<CollectionWithDesigns | null>(null)
  const [tracker, setTracker] = useState<JobTracker | null>(null)
  const [availableDesigns, setAvailableDesigns] = useState<DesignSubmission[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataOwnerKey, setDataOwnerKey] = useState<string | null>(null)
  const [dataCollectionId, setDataCollectionId] = useState<string | null>(null)

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showAddDesignModal, setShowAddDesignModal] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const modalReturnFocusRef = useRef<HTMLElement | null>(null)

  const collectionId = params.collectionId ?? ''

  function openModal(setOpen: (open: boolean) => void) {
    modalReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }

  function restoreModalTriggerFocus(event: Event) {
    if (!modalReturnFocusRef.current) return
    event.preventDefault()
    modalReturnFocusRef.current.focus()
  }

  const fetchData = useCallback((signal?: AbortSignal) => {
    if (!collectionId) return
    return fetch(`/api/collections/${collectionId}`, { signal })
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then((data) => {
        setMode(data.mode)
        if (data.mode === 'quote') {
          setQuote(data.quote)
          setLinkedCollection(data.linkedCollection)
          setTracker(data.tracker)
        } else {
          setCollection(data.collection)
          setAvailableDesigns(data.availableDesigns || [])
          setTracker(data.tracker)
        }
        setDataOwnerKey(currentOwnerKey)
        setDataCollectionId(collectionId)
        setDataLoading(false)
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        setDataLoading(false)
      })
  }, [collectionId, currentOwnerKey])

  useEffect(() => {
    if (companyLoading) return

    if (!currentOwnerKey) {
      setMode(null)
      setCollection(null)
      setQuote(null)
      setLinkedCollection(null)
      setTracker(null)
      setAvailableDesigns([])
      setDataOwnerKey(null)
      setDataCollectionId(null)
      setDataLoading(false)
      return
    }

    if (!collectionId) {
      setDataLoading(false)
      return
    }

    if (
      dataOwnerKey === currentOwnerKey &&
      dataCollectionId === collectionId &&
      (collection || quote || mode !== null)
    ) {
      setDataLoading(false)
      return
    }

    const controller = new AbortController()
    setMode(null)
    setCollection(null)
    setQuote(null)
    setLinkedCollection(null)
    setTracker(null)
    setAvailableDesigns([])
    setDataLoading(true)
    fetchData(controller.signal)
    return () => controller.abort()
  }, [
    companyLoading,
    currentOwnerKey,
    dataOwnerKey,
    dataCollectionId,
    collectionId,
    collection,
    quote,
    mode,
    fetchData,
  ])

  if (companyLoading || dataLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-32 bg-gray-200 rounded-2xl" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="h-64 bg-gray-200 rounded-2xl" />
            <div className="h-64 bg-gray-200 rounded-2xl" />
            <div className="h-64 bg-gray-200 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!access) return null

  // Quote mode
  if (mode === 'quote' && quote) {
    return (
      <QuoteDetail
        quote={quote}
        linkedCollection={linkedCollection}
        tracker={tracker}
      />
    )
  }

  // Collection mode
  if (!collection) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="card-elevated p-12 text-center">
          <h2 className="text-lg font-semibold text-gray-900">Collection not found</h2>
          <Link href="/my-collections" className="mt-4 btn-primary inline-block">
            Back to My Orders
          </Link>
        </div>
      </div>
    )
  }

  const isDraft = collection.status === 'draft'
  const isSubmitted = collection.status === 'submitted'
  const isApproved = collection.status === 'approved'
  const isRejected = collection.status === 'rejected'
  const canSubmit = isDraft && collection.design_count > 0

  async function handleRemoveDesign(designId: string) {
    if (!collection) return
    setActionError(null)
    const result = await removeDesignAction(collection.id, designId)
    if (result.error) {
      setActionError(result.error)
    } else {
      fetchData()
    }
  }

  async function handleAddDesign(designId: string) {
    if (!collection) return
    setActionError(null)
    const result = await addDesignAction(collection.id, designId)
    if (result.error) {
      setActionError(result.error)
    } else {
      setShowAddDesignModal(false)
      fetchData()
    }
  }

  async function handleSubmit() {
    if (!collection) return
    setActionError(null)
    const result = await submitCollectionAction(collection.id)
    if (result.error) {
      setActionError(result.error)
    } else {
      setShowSubmitConfirm(false)
      fetchData()
    }
  }

  async function handleDelete() {
    if (!collection) return
    setActionError(null)
    const result = await deleteCollectionAction(collection.id)
    if (result.error) {
      setActionError(result.error)
    } else {
      router.push('/my-collections')
    }
  }

  async function handleRevise() {
    if (!collection) return
    setActionError(null)
    const result = await reviseCollectionAction(collection.id)
    if (result.error) {
      setActionError(result.error)
    } else {
      fetchData()
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setActionError(null)
    const formData = new FormData(e.currentTarget)
    formData.set('collectionId', collection!.id)
    const result = await updateCollectionAction(formData)
    if (result.error) {
      setActionError(result.error)
    } else {
      setShowEditModal(false)
      fetchData()
    }
  }

  const trackerUrl = tracker?.tracker_token ? getPortalTrackerPath(tracker.tracker_token) : null

  return (
    <div className="max-w-7xl mx-auto space-y-6 motion-safe:animate-portal-enter">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/my-collections" className="text-gray-500 hover:text-gray-700" title="Back to My Orders">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{collection.name}</h1>
            <StatusBadge status={collection.status} />
          </div>
          {collection.description && (
            <p className="mt-2 text-gray-600 ml-8">{collection.description}</p>
          )}
          <p className="mt-1 text-sm text-gray-500 ml-8">
            {collection.design_count} design{collection.design_count !== 1 ? 's' : ''} &bull;{' '}
            Created {new Date(collection.created_at).toLocaleDateString('en-NZ')}
          </p>
        </div>

        {isDraft && (
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={() => openModal(setShowEditModal)} className="btn-secondary flex items-center gap-2 flex-1 sm:flex-none">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Edit
            </button>
            <button onClick={() => openModal(setShowDeleteConfirm)} className="btn-ghost text-red-600 hover:bg-red-50/50 flex-1 sm:flex-none">
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="glass-error-box p-3">
          <p className="text-sm">{actionError}</p>
        </div>
      )}

      {/* Status Messages */}
      {isDraft && collection.design_count > 0 && (
        <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-gray-700">
              <p className="font-medium text-gray-900">Ready to submit?</p>
              <p className="mt-1">
                Add all the designs you need, then submit for review. Our team will check artwork quality, print
                compatibility, and confirm final pricing. This usually takes 1-2 business days.
              </p>
            </div>
          </div>
        </div>
      )}

      {isSubmitted && (
        <div className="p-4 bg-[rgb(var(--color-brand-yellow))]/10 rounded-xl border border-[rgb(var(--color-brand-blue))]/15">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm">
              <p className="font-medium text-[rgb(var(--color-primary))]">Under Review</p>
              <p className="text-gray-700 mt-1">
                Our team is reviewing your designs. We check artwork resolution, colour accuracy, and print
                compatibility. This usually takes 1-2 business days.
              </p>
            </div>
          </div>
        </div>
      )}

      {isApproved && (
        <div className="glass-success-box">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-[rgb(var(--color-brand-blue))] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm">
              <p className="font-medium text-[rgb(var(--color-brand-blue))]">Approved — Ready to Order</p>
              <p className="text-[rgb(var(--color-brand-blue))]/80 mt-1">
                Your designs have been approved with confirmed pricing.
                {trackerUrl ? ' You can track your order progress below.' : ' Contact us to place your order.'}
              </p>
              {trackerUrl && (
                <Link
                  href={trackerUrl}
                  className="mt-2 inline-flex items-center gap-1 text-[rgb(var(--color-brand-blue))] font-medium hover:underline"
                >
                  View Order Tracker
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="glass-error-box">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm flex-1">
              <p className="font-medium text-red-800">Changes Requested</p>
              {collection.notes && (
                <p className="text-red-700 mt-1">
                  <strong>Reason:</strong> {collection.notes}
                </p>
              )}
              <div className="mt-3 p-3 bg-red-50/50 rounded-lg border border-red-200/30">
                <p className="font-medium text-red-800 text-xs uppercase tracking-wide">What to do next</p>
                <ul className="mt-1 space-y-1 text-red-700">
                  <li>&bull; Review the feedback above</li>
                  <li>&bull; Click &quot;Revise &amp; Resubmit&quot; to edit your designs</li>
                  <li>&bull; Fix the issues and submit again for review</li>
                </ul>
              </div>
              <button
                type="button"
                onClick={handleRevise}
                className="mt-3 btn-primary"
              >
                Revise &amp; Resubmit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Designs Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Designs ({collection.design_count})
          </h2>
          {isDraft && availableDesigns.length > 0 && (
            <button
              onClick={() => openModal(setShowAddDesignModal)}
              className="btn-secondary flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Existing
            </button>
          )}
        </div>

        {collection.designs.length === 0 ? (
          <div className="card-elevated p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[rgb(var(--color-primary))]/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-[rgb(var(--color-primary))]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-500 mb-4">No designs in this collection yet.</p>
            {isDraft && availableDesigns.length > 0 && (
              <button onClick={() => openModal(setShowAddDesignModal)} className="btn-primary">
                Add Design
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {collection.designs.map((design) => (
              <DesignCard
                key={design.id}
                design={design}
                canRemove={isDraft}
                showStatus={!isDraft}
                onRemove={() => handleRemoveDesign(design.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Submit Button */}
      {canSubmit && (
        <div className="flex justify-end pt-6 border-t border-gray-100">
          <button onClick={() => openModal(setShowSubmitConfirm)} className="btn-primary flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Submit for Approval
          </button>
        </div>
      )}

      {/* Edit Modal */}
      <Dialog.Root open={showEditModal} onOpenChange={setShowEditModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="glass-modal-backdrop" />
          <Dialog.Content
            className="glass-modal-content fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2"
            onCloseAutoFocus={restoreModalTriggerFocus}
          >
            <div className="p-6">
              <Dialog.Title className="text-xl font-bold text-gray-900 mb-4">Edit Collection</Dialog.Title>
              <Dialog.Description className="sr-only">
                Update the collection name or description.
              </Dialog.Description>
              <form onSubmit={handleEdit} className="space-y-4">
                <div>
                  <label htmlFor="editName" className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input type="text" id="editName" name="name" defaultValue={collection.name} required className="input-glass" />
                </div>
                <div>
                  <label htmlFor="editDesc" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea id="editDesc" name="description" rows={3} defaultValue={collection.description || ''} className="textarea-glass" />
                </div>
                <div className="flex gap-3 pt-2">
                  <Dialog.Close asChild>
                    <button type="button" className="flex-1 btn-secondary">Cancel</button>
                  </Dialog.Close>
                  <button type="submit" className="flex-1 btn-primary">Save</button>
                </div>
              </form>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Delete Confirm Modal */}
      <Dialog.Root open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="glass-modal-backdrop" />
          <Dialog.Content
            className="glass-modal-content fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-6 text-center"
            onCloseAutoFocus={restoreModalTriggerFocus}
          >
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <Dialog.Title className="text-lg font-semibold text-gray-900">Delete &quot;{collection.name}&quot;?</Dialog.Title>
            <Dialog.Description className="text-sm text-gray-500 mt-2">This action cannot be undone. Designs will be unlinked but not deleted.</Dialog.Description>
            <div className="flex gap-3 mt-6">
              <Dialog.Close asChild>
                <button type="button" className="flex-1 btn-secondary">Cancel</button>
              </Dialog.Close>
              <button type="button" onClick={handleDelete} className="flex-1 btn-danger">Delete</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Submit Confirm Modal */}
      <Dialog.Root open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="glass-modal-backdrop" />
          <Dialog.Content
            className="glass-modal-content fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
            onCloseAutoFocus={restoreModalTriggerFocus}
          >
            <Dialog.Title className="text-lg font-semibold text-gray-900">Submit for Approval?</Dialog.Title>
            <Dialog.Description className="text-sm text-gray-600 mt-2">
              Your collection with {collection.design_count} design{collection.design_count !== 1 ? 's' : ''} will be sent
              for review. Our team will check artwork quality and confirm pricing. This usually takes 1-2 business days.
            </Dialog.Description>
            <div className="flex gap-3 mt-6">
              <Dialog.Close asChild>
                <button type="button" className="flex-1 btn-secondary">Cancel</button>
              </Dialog.Close>
              <button type="button" onClick={handleSubmit} className="flex-1 btn-primary">Submit</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Add Design Modal */}
      <Dialog.Root open={showAddDesignModal} onOpenChange={setShowAddDesignModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="glass-modal-backdrop" />
          <Dialog.Content
            className="glass-modal-content fixed left-1/2 top-1/2 z-[60] max-h-[80vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto"
            onCloseAutoFocus={restoreModalTriggerFocus}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-xl font-bold text-gray-900">Add Design</Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className="text-gray-400 hover:text-gray-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">
                Select an existing design to add to this collection.
              </Dialog.Description>
              {availableDesigns.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No available designs to add.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {availableDesigns.map((design) => (
                    <button
                      key={design.id}
                      type="button"
                      onClick={() => handleAddDesign(design.id)}
                      className="card-interactive overflow-hidden text-left"
                    >
                      <div className="aspect-square bg-gray-100/50">
                        {design.images && design.images[0] ? (
                          <img src={design.images[0]} alt={design.design_name} className="w-full h-full object-contain p-2" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{design.design_name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

const LABEL_CAP =
  'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500'

const SUPPORT_MAILTO = 'mailto:hello@theprint-room.co.nz'

interface QuoteItem {
  id?: string
  product_name?: string | null
  productTitle?: string | null
  quantity?: number | null
  unit_price?: number | null
  total_price?: number | null
  variant_label?: string | null
  decorations?: Array<{
    name?: string | null
    unitPrice?: number | null
    unit_price?: number | null
    snapshotUrl?: string | null
    artworkUrl?: string | null
  }> | null
  image_url?: string | null
}

interface ProofFile {
  url: string
  name?: string | null
}

// TODO consolidate inline status labels into lib/orders/status-labels.ts
function QuoteStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: 'Draft', cls: 'bg-gray-50 text-gray-700' },
    submitted: { label: 'Pending review', cls: 'bg-amber-50 text-amber-800' },
    'awaiting-approval': { label: 'Awaiting approval', cls: 'bg-amber-50 text-amber-800' },
    approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700' },
    rejected: { label: 'Changes requested', cls: 'bg-rose-50 text-rose-700' },
    completed: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700' },
    expired: { label: 'Expired', cls: 'bg-gray-50 text-gray-600' },
  }
  const entry = map[status] ?? { label: status, cls: 'bg-gray-50 text-gray-700' }
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${entry.cls}`}
    >
      {entry.label}
    </span>
  )
}

function QuoteDetail({
  quote,
  linkedCollection,
  tracker,
}: {
  quote: Quote
  linkedCollection: CollectionWithDesigns | null
  tracker: JobTracker | null
}) {
  const items = (Array.isArray(quote.line_items) ? quote.line_items : []) as QuoteItem[]
  const totals = {
    subtotal: Number(quote.subtotal || 0),
    shipping: Number(quote.shipping_estimate || 0),
    total: Number(quote.total_amount || 0),
  }
  const proofFiles = (Array.isArray(tracker?.proof_files)
    ? tracker.proof_files
    : []) as ProofFile[]
  const trackerUrl = tracker?.tracker_token ? getPortalTrackerPath(tracker.tracker_token) : null
  const currency = quote.currency || 'NZD'
  const heading =
    quote.reference || `Order ${quote.id.slice(0, 8).toUpperCase()}`
  const customerLine =
    quote.customer_company || quote.customer_name || quote.customer_email

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SetTopBarContext value={{ kind: 'section', label: 'Order summary' }} />
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[var(--portal-topbar-h,76px)] md:px-6 md:pt-[120px]">
        {/* Hero */}
        <header className="mb-10 md:mb-14">
          <Link
            href="/my-collections"
            className="inline-flex rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
            aria-label="Back to my orders"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="mt-4 font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            {heading}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <QuoteStatusChip status={quote.status} />
            <p className="text-sm text-gray-600">
              {new Date(quote.created_at).toLocaleDateString('en-NZ', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}{' '}
              &middot; {customerLine}
            </p>
          </div>
          {linkedCollection && (
            <p className="mt-3 max-w-2xl text-sm text-gray-600">
              Linked design workspace:{' '}
              <Link
                href={`/my-collections/${linkedCollection.id}`}
                className="rounded-full text-gray-900 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
              >
                {linkedCollection.name}
              </Link>
            </p>
          )}
        </header>

        {/* Body */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr,420px] lg:gap-12">
          {/* Left column */}
          <div className="space-y-6">
            {/* Order items */}
            <section className="rounded-[32px] bg-white p-6 md:p-8">
              <h2 className={`mb-6 ${LABEL_CAP}`}>Order summary</h2>
              {items.length === 0 ? (
                <p className="text-sm text-gray-500">No items recorded on this order.</p>
              ) : (
                <div className="space-y-4">
                  {items.map((item, index) => {
                    const decorations = Array.isArray(item.decorations) ? item.decorations : []
                    const itemImage =
                      decorations.find((d) => d?.snapshotUrl)?.snapshotUrl ?? item.image_url
                    const qty = Number(item.quantity || 0)
                    const unitPrice = Number(item.unit_price || 0)
                    const lineTotal =
                      Number(item.total_price || 0) || (qty * unitPrice)
                    return (
                      <article
                        key={item.id || `line-${index}`}
                        className="flex items-start gap-4 border-b border-gray-100 pb-4 last:border-0 last:pb-0 md:gap-5"
                      >
                        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gray-50">
                          {itemImage ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={itemImage}
                              alt={item.product_name || item.productTitle || ''}
                              className="h-full w-full object-contain p-2"
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-dm-sans text-base font-medium text-gray-900">
                            {item.product_name || item.productTitle || 'Item'}
                          </p>
                          {item.variant_label && (
                            <p className={`mt-1 ${LABEL_CAP}`}>{item.variant_label}</p>
                          )}
                          {decorations.length > 0 && (
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              {decorations.map((d, i) => {
                                const icon = d?.snapshotUrl ?? d?.artworkUrl
                                return (
                                  <span
                                    key={`${item.id || index}-deco-${i}`}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-[11px] text-gray-700"
                                  >
                                    {icon ? (
                                      /* eslint-disable-next-line @next/next/no-img-element */
                                      <img
                                        src={icon}
                                        alt=""
                                        className="h-4 w-4 rounded-sm bg-white object-contain"
                                      />
                                    ) : null}
                                    <span className="font-medium">{d?.name || 'Decoration'}</span>
                                  </span>
                                )
                              })}
                            </div>
                          )}
                          <p className="mt-3 text-sm text-gray-500">
                            <span className="tabular-nums text-gray-700">{qty}</span>{' '}
                            ×{' '}
                            <span className="tabular-nums text-gray-700">
                              {formatMoney(unitPrice, currency)}
                            </span>
                          </p>
                        </div>
                        <p className="font-dm-sans text-base font-medium tabular-nums text-gray-900">
                          {formatMoney(lineTotal, currency)}
                        </p>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Notes */}
            {quote.notes && (
              <section className="rounded-[24px] bg-white p-6">
                <h2 className={`mb-3 ${LABEL_CAP}`}>Notes</h2>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{quote.notes}</p>
              </section>
            )}

            {/* Proof files */}
            {proofFiles.length > 0 && (
              <section className="rounded-[24px] bg-white p-6">
                <h2 className={`mb-4 ${LABEL_CAP}`}>Proof files</h2>
                <div className="flex flex-wrap gap-2">
                  {proofFiles.map((file, index) => (
                    <a
                      key={`${file.url}-${index}`}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                    >
                      {file.name || `Proof ${index + 1}`}
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Right column — sticky totals */}
          <aside className="lg:sticky lg:top-[100px] lg:h-fit">
            <div className="rounded-[32px] bg-white p-6 md:p-8">
              <h2 className={`mb-5 ${LABEL_CAP}`}>Order total</h2>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="tabular-nums text-gray-900">
                    {formatMoney(totals.subtotal, currency)}
                  </span>
                </div>
                {/*
                  quote.decoration_cost remains stored for diagnostics, but
                  customer-facing totals show all-in unit/subtotal pricing.
                */}
                <div className="flex justify-between border-t border-gray-100 pt-2.5">
                  <span className="text-gray-600">Shipping</span>
                  <span className="tabular-nums text-gray-900">
                    {totals.shipping > 0
                      ? formatMoney(totals.shipping, currency)
                      : 'Calculated separately'}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between border-t border-gray-100 pt-3">
                  <span className="font-dm-sans text-base font-medium text-gray-900">Total</span>
                  <span className="font-dm-sans text-xl font-medium tabular-nums text-gray-900">
                    {formatMoney(totals.total, currency)}
                  </span>
                </div>
              </div>

              <div className="mt-7 space-y-3">
                {trackerUrl ? (
                  <Link
                    href={trackerUrl}
                    className="flex w-full items-center justify-center rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  >
                    Open tracker
                  </Link>
                ) : (
                  <Link
                    href="/order-tracker"
                    className="flex w-full items-center justify-center rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  >
                    View order tracker
                  </Link>
                )}
                <Link
                  href="/my-collections"
                  className="flex w-full items-center justify-center rounded-full bg-gray-50 px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-2"
                >
                  Back to my orders
                </Link>
              </div>

              <p className="mt-6 text-xs text-gray-500">
                Need to change something on this order?{' '}
                <a
                  href={SUPPORT_MAILTO}
                  className="rounded-full text-gray-700 underline-offset-2 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                >
                  Email us
                </a>{' '}
                and we&rsquo;ll pick it up.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { className: string; label: string }> = {
    draft: { className: 'glass-badge-gray', label: 'Draft' },
    submitted: { className: 'glass-badge-blue', label: 'Pending' },
    approved: { className: 'glass-badge-green', label: 'Approved' },
    rejected: { className: 'glass-badge-red', label: 'Rejected' },
    completed: { className: 'glass-badge-purple', label: 'Completed' },
    expired: { className: 'glass-badge-gray', label: 'Expired' },
  }
  const { className, label } = config[status] || config.draft
  return <span className={className}>{label}</span>
}

function DesignCard({
  design,
  canRemove,
  showStatus,
  onRemove,
}: {
  design: DesignSubmission
  canRemove: boolean
  showStatus?: boolean
  onRemove: () => void
}) {
  const images = design.images || []
  const pricing = design.pricing_data as any
  const hasMultipleViews = images.length > 1

  const designStatusConfig: Record<string, { className: string; label: string }> = {
    pending_review: { className: 'glass-badge-blue', label: 'Pending Review' },
    approved: { className: 'glass-badge-green', label: 'Approved' },
    rejected: { className: 'glass-badge-red', label: 'Needs Changes' },
  }

  return (
    <div className="card-interactive overflow-hidden group">
      <div className="aspect-square bg-gray-100/50 relative">
        {images[0] ? (
          <>
            <img src={images[0]} alt={design.design_name} className="w-full h-full object-contain p-2" loading="lazy" />
            {hasMultipleViews && (
              <div className="glass-chip absolute bottom-2 left-2 text-xs">{images.length} views</div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-red-500/90 text-white rounded-full hover:bg-red-600"
            aria-label="Remove design"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="p-4">
        <p className="font-medium text-gray-900 text-sm line-clamp-2">{design.design_name}</p>
        {pricing?.totalPrice && (
          <p className="text-sm text-gray-600 mt-1">
            {formatMoney(pricing.totalPrice, pricing.currency || 'NZD')}
          </p>
        )}
        {showStatus && design.status && (
          <div className="mt-2">
            <span className={`${(designStatusConfig[design.status] || designStatusConfig.pending_review).className} text-xs`}>
              {(designStatusConfig[design.status] || designStatusConfig.pending_review).label}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
