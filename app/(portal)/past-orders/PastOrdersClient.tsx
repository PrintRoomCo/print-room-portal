'use client'

import { useEffect, useState } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { getPortalOwnerKey } from '@/lib/portal-owner'
import type { PortalPastOrdersData, PortalPastOrder } from '@/lib/portal-data'
import { orderStatusLabel, type OrderStatus } from '@/lib/orders/status-labels'
import { filterPastOrders } from '@/lib/orders/past-orders-filter'
import { OrdersTable } from './OrdersTable'

type Order = PortalPastOrder

interface PastOrdersClientProps {
  initialData: PortalPastOrdersData
}

export function PastOrdersClient({ initialData }: PastOrdersClientProps) {
  const { access, loading: companyLoading } = useCompany()
  const currentOwnerKey = getPortalOwnerKey(access)
  const [orders, setOrders] = useState<Order[]>(initialData.orders)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [placedByFilter, setPlacedByFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [dataOwnerKey, setDataOwnerKey] = useState(initialData.ownerKey)
  const [dataLoading, setDataLoading] = useState(false)

  useEffect(() => {
    if (companyLoading) return

    if (!currentOwnerKey) {
      setOrders([])
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

    setOrders([])
    setDataLoading(true)

    fetch('/api/past-orders', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { orders: [], ownerKey: currentOwnerKey }))
      .then((data: PortalPastOrdersData) => {
        if (stale) return
        setOrders(data.orders || [])
        setDataOwnerKey(data.ownerKey ?? currentOwnerKey)
        setDataLoading(false)
      })
      .catch((error) => {
        if (stale || error?.name === 'AbortError') return
        setOrders([])
        setDataOwnerKey(currentOwnerKey)
        setDataLoading(false)
      })

    return () => {
      stale = true
      controller.abort()
    }
  }, [companyLoading, currentOwnerKey, dataOwnerKey])

  const statusOptions = Array.from(new Set(orders.map((o) => o.status)))
  const placedByOptions = Array.from(
    new Set(orders.map((o) => o.customerEmail).filter(Boolean)),
  ) as string[]
  const filteredOrders = filterPastOrders(orders, {
    status: statusFilter,
    from: dateFrom || null,
    to: dateTo || null,
  }).filter((o) => placedByFilter === 'all' || o.customerEmail === placedByFilter)

  const exportQuery = new URLSearchParams({
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(dateFrom ? { from: dateFrom } : {}),
    ...(dateTo ? { to: dateTo } : {}),
  }).toString()
  const exportHref = (granularity: 'order' | 'line') =>
    `/api/past-orders/export?granularity=${granularity}${exportQuery ? `&${exportQuery}` : ''}`

  if (!access && !companyLoading) return null

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] motion-safe:animate-portal-enter md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans text-[clamp(40px,5vw,72px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            Orders
          </h1>
        </header>

        {orders.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {orderStatusLabel(s as OrderStatus)}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-full bg-gray-100 px-4 py-1.5 text-xs text-gray-700"
              aria-label="From date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-full bg-gray-100 px-4 py-1.5 text-xs text-gray-700"
              aria-label="To date"
            />
            {/* TODO(store-filter): blocked on store-attribution decision */}
            {access?.canSeeAllOrgOrders && placedByOptions.length > 1 && (
              <select
                value={placedByFilter}
                onChange={(e) => setPlacedByFilter(e.target.value)}
                className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700"
                aria-label="Placed by"
              >
                <option value="all">All members</option>
                {placedByOptions.map((email) => (
                  <option key={email} value={email}>
                    {email}
                  </option>
                ))}
              </select>
            )}
            {/* Plain anchors, not fetch — the browser handles the CSV download
                via Content-Disposition. Placed-by is a view-only filter; the
                export params are locked to granularity|status|from|to. */}
            <div className="ml-auto flex items-center gap-2">
              <a
                href={exportHref('order')}
                className="rounded-full bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
              >
                Export orders
              </a>
              <a
                href={exportHref('line')}
                className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
              >
                Export line items
              </a>
            </div>
          </div>
        )}

        <div
          className={
            dataLoading
              ? 'opacity-60 transition-opacity duration-150'
              : 'transition-opacity duration-150'
          }
        >
          {filteredOrders.length > 0 ? (
            <OrdersTable orders={filteredOrders} />
          ) : orders.length > 0 ? (
            <PortalEmptyState
              title="No matches"
              body="Try widening the status or date filters."
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
