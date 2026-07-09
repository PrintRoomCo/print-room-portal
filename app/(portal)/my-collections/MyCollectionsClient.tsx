'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { getPortalOwnerKey } from '@/lib/portal-owner'
import type { PortalAccountData, PortalAccountQuote } from '@/lib/portal-data'

type StatusFilter = 'awaiting' | 'approved'
type Quote = PortalAccountQuote

function formatCurrency(value: number | null | undefined, currency = 'NZD'): string {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

interface MyCollectionsClientProps {
  initialData: PortalAccountData
}

export function MyCollectionsClient({ initialData }: MyCollectionsClientProps) {
  const { access, loading: companyLoading } = useCompany()
  const currentOwnerKey = getPortalOwnerKey(access)
  const [quotes, setQuotes] = useState<Quote[]>(
    initialData.recentQuotes.filter((q) => q.source !== 'b2b-portal-design-collection'),
  )
  const [dataOwnerKey, setDataOwnerKey] = useState(initialData.ownerKey)
  const [dataLoading, setDataLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('awaiting')

  useEffect(() => {
    if (companyLoading) return

    if (!currentOwnerKey) {
      setQuotes([])
      setDataOwnerKey(null)
      setDataLoading(false)
      return
    }

    if (currentOwnerKey === dataOwnerKey) {
      setDataLoading(false)
      return
    }

    const controller = new AbortController()
    let stale = false

    setQuotes([])
    setDataLoading(true)

    fetch('/api/account-data', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { recentQuotes: [], ownerKey: currentOwnerKey }))
      .then((data: PortalAccountData) => {
        if (stale) return
        setQuotes(
          (data.recentQuotes || []).filter(
            (q) => q.source !== 'b2b-portal-design-collection',
          ),
        )
        setDataOwnerKey(data.ownerKey ?? currentOwnerKey)
        setDataLoading(false)
      })
      .catch((error) => {
        if (stale || error?.name === 'AbortError') return
        setQuotes([])
        setDataOwnerKey(currentOwnerKey)
        setDataLoading(false)
      })

    return () => {
      stale = true
      controller.abort()
    }
  }, [companyLoading, currentOwnerKey, dataOwnerKey])

  const filteredQuotes =
    statusFilter === 'approved'
      ? quotes.filter((q) => q.status === 'approved')
      : quotes.filter((q) => q.status !== 'approved')

  if (!access && !companyLoading) return null

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] motion-safe:animate-portal-enter md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans text-[clamp(40px,5vw,72px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            Orders
          </h1>
        </header>

        {quotes.length > 0 && (
          <div className="mb-6 flex">
            <div className="inline-flex rounded-full bg-gray-100 p-1">
              <FilterChip
                active={statusFilter === 'awaiting'}
                onClick={() => setStatusFilter('awaiting')}
              >
                Awaiting
              </FilterChip>
              <FilterChip
                active={statusFilter === 'approved'}
                onClick={() => setStatusFilter('approved')}
              >
                Approved
              </FilterChip>
            </div>
          </div>
        )}

        <div className={dataLoading ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'}>
          {filteredQuotes.length > 0 ? (
            <div className="space-y-4">
              {filteredQuotes.map((quote) => (
                <QuoteCard key={quote.id} quote={quote} />
              ))}
            </div>
          ) : quotes.length > 0 ? (
            <PortalEmptyState
              title="No matches"
              body={
                statusFilter === 'awaiting'
                  ? 'Nothing waiting on you right now.'
                  : 'No approved orders yet.'
              }
            />
          ) : (
            <PortalEmptyState
              title="Nothing here yet"
              body="Start creating orders by browsing our catalogue."
              actionHref="/catalogue"
              actionLabel="Browse catalogue"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function QuoteCard({ quote }: { quote: Quote }) {
  const title =
    quote.reference ||
    quote.quote_number ||
    `#${quote.id.slice(0, 8).toUpperCase()}`

  const customer =
    quote.customer_company || quote.customer_name || quote.customer_email

  const statusLabel = quote.status
    ? quote.status.charAt(0).toUpperCase() + quote.status.slice(1)
    : 'Pending'

  return (
    <Link
      href={`/my-collections/${quote.id}`}
      className="block rounded-3xl bg-white p-6 transition-colors duration-200 hover:bg-gray-50 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-black">{title}</h3>
          <p className="mt-1 text-sm text-gray-600">
            {new Date(quote.created_at).toLocaleDateString('en-NZ', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}{' '}
            · {customer}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="font-semibold text-black">
            {formatCurrency(quote.total_amount, quote.currency)}{' '}
            <span className="text-sm font-normal text-black">
              {quote.currency}
            </span>
          </p>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">
        Subtotal {formatCurrency(quote.subtotal, quote.currency)}
      </div>
    </Link>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-150 active:scale-[0.98] ${
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  )
}
