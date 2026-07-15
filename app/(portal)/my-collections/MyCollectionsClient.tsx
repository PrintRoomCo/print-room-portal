'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { getPortalOwnerKey } from '@/lib/portal-owner'
import type { PortalPastOrdersData, PortalPastOrder } from '@/lib/portal-data'
import { orderStatusLabel, type OrderStatus } from '@/lib/orders/status-labels'
import { filterPastOrders } from '@/lib/orders/past-orders-filter'

type Order = PortalPastOrder

function formatCurrency(value: number | null | undefined, currency = 'NZD'): string {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

interface MyCollectionsClientProps {
  initialData: PortalPastOrdersData
}

export function MyCollectionsClient({ initialData }: MyCollectionsClientProps) {
  const { access, loading: companyLoading } = useCompany()
  const currentOwnerKey = getPortalOwnerKey(access)
  const [orders, setOrders] = useState<Order[]>(initialData.orders)
  const [statusFilter, setStatusFilter] = useState<string>('all')
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
  const filteredOrders = filterPastOrders(orders, {
    status: statusFilter,
    from: dateFrom || null,
    to: dateTo || null,
  })

  if (!access && !companyLoading) return null

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] motion-safe:animate-portal-enter md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans text-[clamp(40px,5vw,72px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            Past orders
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
            <div className="space-y-4">
              {filteredOrders.map((order) => (
                <OrderCard key={order.orderId} order={order} />
              ))}
            </div>
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

function OrderCard({ order }: { order: Order }) {
  const title =
    order.orderRef ||
    order.reference ||
    order.quoteNumber ||
    `#${order.orderId.slice(0, 8).toUpperCase()}`

  const customer =
    order.customerCompany || order.customerName || order.customerEmail

  const statusLabel = orderStatusLabel(order.status as OrderStatus)
  const trackingNumber = order.tracking?.trackingNumber
  const trackingUrl = order.tracking?.url ?? undefined

  return (
    <Link
      href={`/my-collections/${order.quoteId ?? order.orderId}`}
      className="block rounded-3xl bg-white p-6 transition-colors duration-200 hover:bg-gray-50 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-black">{title}</h3>
          <p className="mt-1 text-sm text-gray-600">
            {new Date(order.createdAt).toLocaleDateString('en-NZ', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}{' '}
            · {customer}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="font-semibold text-black">
            {formatCurrency(order.totalAmount, order.currency)}{' '}
            <span className="text-sm font-normal text-black">{order.currency}</span>
          </p>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">
        {trackingNumber ? (
          <span>
            Tracking {order.tracking?.carrier ? `(${order.tracking.carrier}) ` : ''}
            {trackingUrl ? (
              <span className="text-gray-700 underline">{trackingNumber}</span>
            ) : (
              <span className="text-gray-700">{trackingNumber}</span>
            )}
          </span>
        ) : (
          <span>Subtotal {formatCurrency(order.subtotal, order.currency)}</span>
        )}
      </div>
    </Link>
  )
}
