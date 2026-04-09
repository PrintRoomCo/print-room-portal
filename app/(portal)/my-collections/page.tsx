'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'

type QuoteFilter = 'active' | 'expired'

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

export default function MyCollections() {
  const { access, loading: companyLoading } = useCompany()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('active')

  const fetchData = useCallback(() => {
    fetch('/api/account-data')
      .then((r) => (r.ok ? r.json() : { recentQuotes: [] }))
      .then((data) => {
        const allQuotes = (data.recentQuotes || []) as Quote[]
        // Filter out design-collection-linked quotes
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

  const filteredQuotes = quoteFilter === 'active'
    ? quotes.filter((q) => q.status !== 'expired')
    : quotes.filter((q) => q.status === 'expired')

  if (companyLoading || dataLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="flex gap-2">
            <div className="h-10 bg-gray-200 rounded-full w-24" />
            <div className="h-10 bg-gray-200 rounded-full w-24" />
          </div>
          <div className="space-y-3">
            <div className="h-20 bg-gray-200 rounded-2xl" />
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Quotes</h1>
        <p className="mt-1 text-gray-600">View and manage your quotes.</p>
      </div>

      {/* Active/Expired Toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setQuoteFilter('active')}
          className={`filter-tab ${quoteFilter === 'active' ? 'filter-tab-active' : ''}`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setQuoteFilter('expired')}
          className={`filter-tab ${quoteFilter === 'expired' ? 'filter-tab-active' : ''}`}
        >
          Expired
        </button>
      </div>

      {/* Quotes List */}
      {filteredQuotes.length === 0 ? (
        <div className="card-elevated p-8 text-center">
          <p className="text-gray-500">
            {quoteFilter === 'active'
              ? 'No active quotes.'
              : 'No expired quotes.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredQuotes.map((quote) => (
            <Link
              key={quote.id}
              href={`/my-collections/${quote.id}`}
              className="card-interactive block p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {quote.reference || quote.quote_number || `Quote ${quote.id.slice(0, 8).toUpperCase()}`}
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
    </div>
  )
}
