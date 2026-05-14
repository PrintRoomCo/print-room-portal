'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { JobTrackerOrderCard } from '@/components/orders/JobTrackerOrderCard'
import { TrackerSummaryCards } from '@/components/orders/TrackerSummaryCards'
import { isTrackerCompleted, type JobTracker } from '@/lib/job-tracker'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { PortalSkeleton } from '@/components/ui/PortalSkeleton'

type StatusFilter = 'active' | 'completed'

const LABEL_CAP =
  'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500'

export default function OrderTracker() {
  const { access, loading: companyLoading } = useCompany()
  const [trackers, setTrackers] = useState<JobTracker[]>([])
  const [isCompanyWide, setIsCompanyWide] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  const fetchTrackers = useCallback(() => {
    fetch('/api/order-tracker')
      .then((res) => (res.ok ? res.json() : { trackers: [], isCompanyWide: false }))
      .then((data) => {
        setTrackers(data.trackers || [])
        setIsCompanyWide(data.isCompanyWide || false)
        setDataLoading(false)
      })
      .catch(() => setDataLoading(false))
  }, [])

  useEffect(() => {
    if (!companyLoading && access) {
      fetchTrackers()
    } else if (!companyLoading) {
      setDataLoading(false)
    }
  }, [companyLoading, access, fetchTrackers])

  const filteredTrackers = useMemo(() => {
    let result =
      statusFilter === 'active'
        ? trackers.filter((t) => !isTrackerCompleted(t.status))
        : trackers.filter((t) => isTrackerCompleted(t.status))

    if (search.trim()) {
      const query = search.toLowerCase().trim()
      result = result.filter(
        (t) =>
          t.quote_number?.toLowerCase().includes(query) ||
          t.monday_project_name?.toLowerCase().includes(query) ||
          t.tracker_token?.toLowerCase().includes(query) ||
          t.job_reference?.toLowerCase().includes(query) ||
          t.customer_email?.toLowerCase().includes(query),
      )
    }

    return result
  }, [trackers, search, statusFilter])

  if (companyLoading || dataLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
          <PortalSkeleton rows={3} />
        </div>
      </div>
    )
  }

  if (!access) return null

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        {/* Editorial hero */}
        <header className="mb-10 md:mb-12">
          <p className={LABEL_CAP}>Order tracker</p>
          <h1 className="mt-2 font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Tracking
          </h1>
          <p className="mt-4 max-w-prose text-base text-gray-600">
            Track active production work and revisit completed orders.
          </p>
        </header>

        {/* Summary cards */}
        {trackers.length > 0 && (
          <div className="mb-8">
            <TrackerSummaryCards
              trackers={trackers}
              isCompanyWide={isCompanyWide}
            />
          </div>
        )}

        {/* Search + filter */}
        {trackers.length > 0 && (
          <div className="mb-6 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by project, name, or reference…"
                className="w-full rounded-full bg-white py-2.5 pl-10 pr-4 text-sm transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
            <div className="inline-flex rounded-full bg-gray-100 p-1">
              <FilterChip
                active={statusFilter === 'active'}
                onClick={() => setStatusFilter('active')}
              >
                Active
              </FilterChip>
              <FilterChip
                active={statusFilter === 'completed'}
                onClick={() => setStatusFilter('completed')}
              >
                Completed
              </FilterChip>
            </div>
          </div>
        )}

        {/* Tracker list */}
        {filteredTrackers.length > 0 ? (
          <div className="space-y-4">
            {filteredTrackers.map((tracker) => (
              <JobTrackerOrderCard
                key={tracker.id}
                tracker={tracker}
                showCustomerEmail={isCompanyWide}
              />
            ))}
          </div>
        ) : trackers.length > 0 ? (
          <PortalEmptyState
            title="No matches"
            body={`Try ${search ? 'a different search term' : 'changing the filter'} to widen the list.`}
          />
        ) : (
          <PortalEmptyState
            title="Nothing tracked yet"
            body="When your orders enter production, they will appear here with live status updates."
            actionHref="/catalogue"
            actionLabel="Browse catalogue"
          />
        )}
      </div>
    </div>
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
      className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-150 ${
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  )
}
