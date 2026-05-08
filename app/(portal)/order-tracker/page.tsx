'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { JobTrackerOrderCard } from '@/components/orders/JobTrackerOrderCard'
import { TrackerSummaryCards } from '@/components/orders/TrackerSummaryCards'
import { isTrackerCompleted, type JobTracker } from '@/lib/job-tracker'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { PortalSkeleton } from '@/components/ui/PortalSkeleton'

type StatusFilter = 'active' | 'completed'

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
    let result = statusFilter === 'active'
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
          t.customer_email?.toLowerCase().includes(query)
      )
    }

    return result
  }, [trackers, search, statusFilter])

  if (companyLoading || dataLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <PortalSkeleton rows={3} />
      </div>
    )
  }

  if (!access) return null

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Order tracker</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Tracking</h1>
        <p className="mt-1 text-sm text-gray-600">
          Track active production work and revisit completed orders.
        </p>
      </div>

      {/* Summary Cards */}
      {trackers.length > 0 && (
        <TrackerSummaryCards trackers={trackers} isCompanyWide={isCompanyWide} />
      )}

      {/* Search + Filter */}
      {trackers.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by project #, name, or reference..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-full bg-white focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary))]/20 focus:border-[rgb(var(--color-primary))] transition-all duration-300"
            />
          </div>
          <div className="flex gap-2">
            <FilterButton active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>
              Active
            </FilterButton>
            <FilterButton active={statusFilter === 'completed'} onClick={() => setStatusFilter('completed')}>
              Completed
            </FilterButton>
          </div>
        </div>
      )}

      {/* Tracker List */}
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
          actionHref="/shop"
          actionLabel="Browse catalogue"
        />
      )}
    </div>
  )
}

function FilterButton({
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
      className={`filter-tab ${active ? 'filter-tab-active' : ''}`}
    >
      {children}
    </button>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  )
}
