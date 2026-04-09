'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { createCollectionAction } from './actions'
import type { CollectionWithDesigns } from '@/lib/collections'

type StatusFilter = 'all' | 'draft' | 'submitted' | 'approved'

function formatCurrency(value: number | null | undefined, currency = 'NZD'): string {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'submitted':
      return 'glass-badge-blue'
    case 'approved':
      return 'glass-badge-green'
    case 'rejected':
      return 'glass-badge-red'
    case 'completed':
      return 'glass-badge-purple'
    case 'expired':
      return 'glass-badge-gray'
    default:
      return 'glass-badge-yellow'
  }
}

interface Quote {
  id: string
  reference: string | null
  quote_number: string | null
  status: string
  customer_name: string | null
  customer_email: string
  customer_company: string | null
  subtotal: number
  total_amount: number
  currency: string
  source: string | null
  created_at: string
}

interface Summary {
  totalQuotes: number
  submittedQuotes: number
  totalValue: number
  activeCollections: number
}

export default function MyCollections() {
  const { access, loading: companyLoading } = useCompany()
  const [collections, setCollections] = useState<CollectionWithDesigns[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [summary, setSummary] = useState<Summary>({
    totalQuotes: 0,
    submittedQuotes: 0,
    totalValue: 0,
    activeCollections: 0,
  })
  const [dataLoading, setDataLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showNewModal, setShowNewModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    Promise.all([
      fetch('/api/collections').then((r) => (r.ok ? r.json() : { collections: [] })),
      fetch('/api/collections-summary').then((r) =>
        r.ok ? r.json() : { totalQuotes: 0, submittedQuotes: 0, totalValue: 0, activeCollections: 0 }
      ),
      fetch('/api/account-data').then((r) => (r.ok ? r.json() : { recentQuotes: [] })),
    ])
      .then(([collData, summaryData, accountData]) => {
        setCollections(collData.collections || [])
        setSummary(summaryData)
        // Filter out design-collection-linked quotes
        const allQuotes = (accountData.recentQuotes || []) as Quote[]
        setQuotes(allQuotes.filter((q: Quote) => q.source !== 'b2b-portal-design-collection'))
        setDataLoading(false)
      })
      .catch(() => setDataLoading(false))
  }, [])

  useEffect(() => {
    if (!companyLoading && access) {
      fetchData()
    } else if (!companyLoading) {
      setDataLoading(false)
    }
  }, [companyLoading, access, fetchData])

  const filteredCollections =
    statusFilter === 'all'
      ? collections
      : collections.filter((c) => c.status === statusFilter)

  async function handleCreateCollection(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    const formData = new FormData(e.currentTarget)
    const result = await createCollectionAction(formData)
    if (result.error) {
      setCreateError(result.error)
      setCreating(false)
    } else {
      setShowNewModal(false)
      setCreating(false)
      fetchData()
    }
  }

  if (companyLoading || dataLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="h-20 bg-gray-200 rounded-2xl" />
            <div className="h-20 bg-gray-200 rounded-2xl" />
            <div className="h-20 bg-gray-200 rounded-2xl" />
            <div className="h-20 bg-gray-200 rounded-2xl" />
          </div>
          <div className="space-y-3">
            <div className="h-20 bg-gray-200 rounded-2xl" />
            <div className="h-20 bg-gray-200 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!access) return null

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Quotes</h1>
          <p className="mt-1 text-gray-600">
            Manage quick quotes and design collections in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="btn-primary"
        >
          New Collection
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-elevated p-4">
          <p className="text-sm text-gray-500">Total Quotes</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.totalQuotes}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-sm text-gray-500">Submitted Quotes</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.submittedQuotes}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-sm text-gray-500">Quote Value</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatCurrency(summary.totalValue)}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-sm text-gray-500">Active Collections</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.activeCollections}</p>
        </div>
      </div>

      {/* Quick Quotes Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Quick Quotes</h2>
          <span className="glass-badge-gray">{quotes.length}</span>
        </div>
        {quotes.length === 0 ? (
          <div className="card-elevated p-6 text-center text-gray-500">
            No quick quotes yet.
          </div>
        ) : (
          <div className="space-y-3">
            {quotes.map((quote) => (
              <Link
                key={quote.id}
                href={`/my-collections/${quote.id}`}
                className="card-interactive block p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {quote.reference || `Quote ${quote.id.slice(0, 8).toUpperCase()}`}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {new Date(quote.created_at).toLocaleDateString('en-NZ')} &bull;{' '}
                      {quote.customer_company || quote.customer_name || quote.customer_email}
                    </p>
                  </div>
                  <span className={getStatusBadge(quote.status)}>{quote.status}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                  <span>Subtotal: {formatCurrency(quote.subtotal, quote.currency)}</span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(quote.total_amount, quote.currency)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Design Collections Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Design Collections</h2>
          <span className="glass-badge-gray">{collections.length}</span>
        </div>

        {/* Filter tabs */}
        {collections.length > 0 && (
          <div className="flex gap-2">
            {(['all', 'draft', 'submitted', 'approved'] as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`filter-tab ${statusFilter === filter ? 'filter-tab-active' : ''}`}
              >
                {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        )}

        {filteredCollections.length === 0 ? (
          <div className="card-elevated p-6 text-center text-gray-500">
            {collections.length === 0
              ? 'No design collections yet.'
              : 'No collections match this filter.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredCollections.map((collection) => (
              <Link
                key={collection.id}
                href={`/my-collections/${collection.quote_id || collection.id}`}
                className="card-interactive block p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      {/* Thumbnail grid */}
                      {collection.designs.length > 0 && (
                        <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 grid grid-cols-2 gap-px bg-gray-100">
                          {collection.designs.slice(0, 4).map((design, i) => (
                            <div key={design.id || i} className="bg-gray-100">
                              {design.images && design.images[0] ? (
                                <img
                                  src={design.images[0]}
                                  alt={design.design_name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-gray-200" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{collection.name}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {collection.design_count} design{collection.design_count !== 1 ? 's' : ''} &bull;{' '}
                          {new Date(collection.created_at).toLocaleDateString('en-NZ')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <span className={getStatusBadge(collection.status)}>{collection.status}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* New Collection Modal */}
      {showNewModal && (
        <div className="glass-modal-backdrop">
          <div className="glass-modal-content max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">New Collection</h2>
                <button
                  onClick={() => {
                    setShowNewModal(false)
                    setCreateError(null)
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {createError && (
                <div className="glass-error-box p-3 mb-4">
                  <p className="text-sm">{createError}</p>
                </div>
              )}

              <form onSubmit={handleCreateCollection} className="space-y-4">
                <div>
                  <label htmlFor="collName" className="block text-sm font-medium text-gray-700 mb-1">
                    Collection Name *
                  </label>
                  <input
                    type="text"
                    id="collName"
                    name="name"
                    required
                    placeholder="e.g., Summer 2025 Uniforms"
                    className="input-glass"
                  />
                </div>
                <div>
                  <label htmlFor="collDesc" className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    id="collDesc"
                    name="description"
                    rows={3}
                    placeholder="Optional description..."
                    className="textarea-glass"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewModal(false)
                      setCreateError(null)
                    }}
                    className="flex-1 btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={creating} className="flex-1 btn-primary">
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
