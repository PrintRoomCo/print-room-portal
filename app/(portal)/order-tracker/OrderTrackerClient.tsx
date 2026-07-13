'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { JobTrackerOrderCard } from '@/components/orders/JobTrackerOrderCard'
import { TrackerSummaryCards } from '@/components/orders/TrackerSummaryCards'
import { isTrackerCompleted, type JobTracker } from '@/lib/job-tracker'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { getPortalOwnerKey } from '@/lib/portal-owner'
import type { PortalOrderTrackerData, PreOrderTrackerItem } from '@/lib/portal-data'
import { ORDER_STATUS_LABELS } from '@/lib/orders/status-labels'
import { CancelPreOrderButton } from './CancelPreOrderButton'

type StatusFilter = 'active' | 'completed'

interface OrderTrackerClientProps {
  initialData: PortalOrderTrackerData
}

export function OrderTrackerClient({ initialData }: OrderTrackerClientProps) {
  const { access, loading: companyLoading } = useCompany()
  const currentOwnerKey = getPortalOwnerKey(access)
  const [trackers, setTrackers] = useState<JobTracker[]>(initialData.trackers)
  const [isCompanyWide, setIsCompanyWide] = useState(initialData.isCompanyWide)
  const [dataOwnerKey, setDataOwnerKey] = useState(initialData.ownerKey)
  const [preOrders, setPreOrders] = useState<PreOrderTrackerItem[]>(initialData.preOrders ?? [])
  const [dataLoading, setDataLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  useEffect(() => {
    if (companyLoading) return

    if (!currentOwnerKey) {
      setTrackers([])
      setIsCompanyWide(false)
      setPreOrders([])
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

    setTrackers([])
    setIsCompanyWide(false)
    setPreOrders([])
    setDataLoading(true)

    fetch('/api/order-tracker', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { trackers: [], isCompanyWide: false, preOrders: [] }))
      .then((data: PortalOrderTrackerData) => {
        if (stale) return
        setTrackers(data.trackers || [])
        setIsCompanyWide(data.isCompanyWide || false)
        setPreOrders(data.preOrders ?? [])
        setDataOwnerKey(data.ownerKey ?? currentOwnerKey)
        setDataLoading(false)
      })
      .catch((error) => {
        if (stale || error?.name === 'AbortError') return
        setTrackers([])
        setIsCompanyWide(false)
        setPreOrders([])
        setDataOwnerKey(currentOwnerKey)
        setDataLoading(false)
      })

    return () => {
      stale = true
      controller.abort()
    }
  }, [companyLoading, currentOwnerKey, dataOwnerKey])

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

  if (!access && !companyLoading) return null

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] motion-safe:animate-portal-enter md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans text-[clamp(40px,5vw,72px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            Track my Project
          </h1>
          <p className="mt-4 max-w-prose text-base text-gray-600">
            Track active production work and revisit completed orders.
          </p>
        </header>

        {preOrders.length > 0 && (
          <div className="mb-10">
            <h2 className="mb-4 text-base font-semibold text-gray-900">
              Orders awaiting your ordering window
            </h2>
            <div className="space-y-3">
              {preOrders.map((order) => (
                <PreOrderRow key={order.orderId} order={order} />
              ))}
            </div>
          </div>
        )}

        {trackers.length > 0 && (
          <div className="mb-8">
            <TrackerSummaryCards
              trackers={trackers}
              isCompanyWide={isCompanyWide}
            />
          </div>
        )}

        {trackers.length > 0 && (
          <div className="mb-6 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by project, name, or reference..."
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

        <div className={dataLoading ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'}>
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
    </div>
  )
}

function PreOrderRow({ order }: { order: PreOrderTrackerItem }) {
  const closesAt = order.periodClosesAt
    ? new Date(order.periodClosesAt).toLocaleDateString('en-NZ', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null

  return (
    <div className="rounded-3xl bg-white px-6 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-black">
            {order.orderRef ? `Order #${order.orderRef}` : `Order ${order.orderId.slice(0, 8)}…`}
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            {ORDER_STATUS_LABELS['awaiting-period-close']}
          </p>
          {closesAt && (
            <p className="mt-1 text-xs text-gray-500">Window closes {closesAt}</p>
          )}
          {order.windowOpen && (
            <p className="mt-2 text-xs text-gray-500">
              Need to change it? Cancel and place a new order before the window closes.
            </p>
          )}
        </div>
        {order.windowOpen && (
          <div className="shrink-0 self-start sm:self-center">
            <CancelPreOrderButton orderId={order.orderId} />
          </div>
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
