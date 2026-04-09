'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCompany } from '@/contexts/CompanyContext'
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
import { getTrackerUrl } from '@/lib/job-tracker'

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
  const [mode, setMode] = useState<'collection' | 'quote' | null>(null)
  const [collection, setCollection] = useState<CollectionWithDesigns | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [linkedCollection, setLinkedCollection] = useState<CollectionWithDesigns | null>(null)
  const [tracker, setTracker] = useState<JobTracker | null>(null)
  const [availableDesigns, setAvailableDesigns] = useState<DesignSubmission[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showAddDesignModal, setShowAddDesignModal] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Extract collectionId from URL
  const collectionId = typeof window !== 'undefined'
    ? window.location.pathname.split('/my-collections/')[1]
    : ''

  const fetchData = useCallback(() => {
    if (!collectionId) return
    fetch(`/api/collections/${collectionId}`)
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
        setDataLoading(false)
      })
      .catch(() => setDataLoading(false))
  }, [collectionId])

  useEffect(() => {
    if (!companyLoading && access) {
      fetchData()
    } else if (!companyLoading) {
      setDataLoading(false)
    }
  }, [companyLoading, access, fetchData])

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
            Back to My Quotes
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

  const trackerUrl = tracker?.tracker_token ? getTrackerUrl(tracker.tracker_token) : null

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/my-collections" className="text-gray-500 hover:text-gray-700" title="Back to My Quotes">
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
            <button onClick={() => setShowEditModal(true)} className="btn-secondary flex items-center gap-2 flex-1 sm:flex-none">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Edit
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} className="btn-ghost text-red-600 hover:bg-red-50/50 flex-1 sm:flex-none">
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
                <a
                  href={trackerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[rgb(var(--color-brand-blue))] font-medium hover:underline"
                >
                  View Order Tracker
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
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
              onClick={() => setShowAddDesignModal(true)}
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
              <button onClick={() => setShowAddDesignModal(true)} className="btn-primary">
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
          <button onClick={() => setShowSubmitConfirm(true)} className="btn-primary flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Submit for Approval
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="glass-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowEditModal(false) }}>
          <div className="glass-modal-content max-w-md w-full">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Edit Collection</h2>
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
                  <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 btn-secondary">Cancel</button>
                  <button type="submit" className="flex-1 btn-primary">Save</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="glass-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false) }}>
          <div className="glass-modal-content max-w-sm w-full p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Delete &quot;{collection.name}&quot;?</h3>
            <p className="text-sm text-gray-500 mt-2">This action cannot be undone. Designs will be unlinked but not deleted.</p>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setShowDeleteConfirm(false)} className="flex-1 btn-secondary">Cancel</button>
              <button type="button" onClick={handleDelete} className="flex-1 btn-danger">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Confirm Modal */}
      {showSubmitConfirm && (
        <div className="glass-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowSubmitConfirm(false) }}>
          <div className="glass-modal-content max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900">Submit for Approval?</h3>
            <p className="text-sm text-gray-600 mt-2">
              Your collection with {collection.design_count} design{collection.design_count !== 1 ? 's' : ''} will be sent
              for review. Our team will check artwork quality and confirm pricing. This usually takes 1-2 business days.
            </p>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setShowSubmitConfirm(false)} className="flex-1 btn-secondary">Cancel</button>
              <button type="button" onClick={handleSubmit} className="flex-1 btn-primary">Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Design Modal */}
      {showAddDesignModal && (
        <div className="glass-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowAddDesignModal(false) }}>
          <div className="glass-modal-content max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Add Design</h2>
                <button onClick={() => setShowAddDesignModal(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
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
          </div>
        </div>
      )}
    </div>
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
  const items = Array.isArray(quote.line_items) ? quote.line_items : []
  const totals = {
    subtotal: Number(quote.subtotal || 0),
    decoration: Number(quote.decoration_cost || 0),
    shipping: Number(quote.shipping_estimate || 0),
    total: Number(quote.total_amount || 0),
  }
  const proofFiles = Array.isArray(tracker?.proof_files) ? tracker.proof_files : []
  const trackerUrl = tracker?.tracker_token ? getTrackerUrl(tracker.tracker_token) : null

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/my-collections" className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
              {quote.reference || `Quote ${quote.id.slice(0, 8).toUpperCase()}`}
            </h1>
            <StatusBadge status={quote.status} />
          </div>
          <p className="mt-2 ml-8 text-sm text-gray-500">
            {new Date(quote.created_at).toLocaleDateString('en-NZ')} &bull;{' '}
            {quote.customer_company || quote.customer_name || quote.customer_email}
          </p>
          {linkedCollection && (
            <p className="mt-1 ml-8 text-sm text-gray-600">
              Linked design workspace:{' '}
              <Link href={`/my-collections/${linkedCollection.id}`} className="text-[rgb(var(--color-primary))] hover:underline">
                {linkedCollection.name}
              </Link>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {trackerUrl && (
            <a href={trackerUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              Open Tracker
            </a>
          )}
        </div>
      </div>

      {/* Quote Items + Totals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white lg:col-span-2">
          <div className="border-b border-black/10 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60">Quote Items</h2>
          </div>
          {items.length === 0 ? (
            <div className="p-6 text-sm text-black/50">No quote items.</div>
          ) : (
            <div className="divide-y divide-black/10">
              {items.map((item: any, index: number) => (
                <div key={item.id || index} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-black">{item.product_name || item.productTitle || 'Item'}</p>
                    <p className="mt-1 text-sm text-black/50">
                      Qty {item.quantity} &times; {formatMoney(item.unit_price || 0, quote.currency)}
                    </p>
                  </div>
                  <p className="font-medium text-black">
                    {formatMoney(item.total_price || (item.quantity * item.unit_price) || 0, quote.currency)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-[#F8F8F8] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60">Totals</h3>
          <div className="mt-3 space-y-2 text-sm text-black/60">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(totals.subtotal, quote.currency)}</span></div>
            <div className="flex justify-between"><span>Decoration</span><span>{formatMoney(totals.decoration, quote.currency)}</span></div>
            <div className="flex justify-between"><span>Shipping</span><span>{formatMoney(totals.shipping, quote.currency)}</span></div>
            <div className="flex justify-between border-t border-black/20 pt-2 text-lg font-bold text-black">
              <span>Total</span><span>{formatMoney(totals.total, quote.currency)}</span>
            </div>
          </div>
          {quote.notes && (
            <div className="mt-4 rounded-lg border border-black/10 bg-white p-3 text-sm text-black/70">
              {quote.notes}
            </div>
          )}
        </div>
      </div>

      {/* Proof Files */}
      {proofFiles.length > 0 && (
        <div className="card-elevated p-4">
          <h3 className="text-sm font-medium text-gray-700">Proof Files</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {proofFiles.map((file: any, index: number) => (
              <a key={`${file.url}-${index}`} href={file.url} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                {file.name || `Proof ${index + 1}`}
              </a>
            ))}
          </div>
        </div>
      )}
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
