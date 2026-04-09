'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { JobTrackerOrderCard } from '@/components/orders/JobTrackerOrderCard'
import { TrackerSummaryCards } from '@/components/orders/TrackerSummaryCards'
import type { JobTracker } from '@/lib/job-tracker'

type StatusFilter = 'active' | 'completed'

const COMPLETED_STATUSES = ['dispatched', 'delivered', 'complete', 'fulfilled']

function isTrackerCompleted(status: string): boolean {
  const normalized = status.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return COMPLETED_STATUSES.some((s) => normalized.includes(s))
}

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
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-20 bg-gray-200 rounded-2xl" />
            <div className="h-20 bg-gray-200 rounded-2xl" />
            <div className="h-20 bg-gray-200 rounded-2xl" />
          </div>
          <div className="h-12 bg-gray-200 rounded-full" />
          <div className="space-y-4">
            <div className="h-40 bg-gray-200 rounded-2xl" />
            <div className="h-40 bg-gray-200 rounded-2xl" />
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
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
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
        <div className="card-elevated p-8 text-center">
          <p className="text-gray-500">
            No trackers match your {search ? 'search' : 'filter'}. Try{' '}
            {search ? 'a different search term' : 'changing the filter'}.
          </p>
        </div>
      ) : (
        <div className="card-elevated p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">No projects yet</h2>
          <p className="mt-2 text-gray-600 max-w-sm mx-auto">
            When your projects enter production, they&apos;ll appear here with live status updates.
          </p>
        </div>
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
