'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PortalPastOrder } from '@/lib/portal-data'
import { orderStatusLabel, type OrderStatus } from '@/lib/orders/status-labels'
import { orderTypeLabel } from '@/lib/orders/order-type'
import {
  sortPastOrders,
  type PastOrderSort,
  type PastOrderSortKey,
} from '@/lib/orders/past-orders-filter'

const COLUMNS: Array<{ key: PastOrderSortKey; label: string; numeric?: boolean }> = [
  { key: 'createdAt', label: 'Date' },
  { key: 'orderRef', label: 'Order ref' },
  { key: 'placedBy', label: 'Placed by' },
  { key: 'orderType', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'productValue', label: 'Product value', numeric: true },
  { key: 'billed', label: 'Billed', numeric: true },
]

function formatCurrency(value: number, currency = 'NZD'): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

export function OrdersTable({ orders }: { orders: PortalPastOrder[] }) {
  const [sort, setSort] = useState<PastOrderSort>({ key: 'createdAt', dir: 'desc' })
  const sorted = sortPastOrders(orders, sort)

  function toggle(key: PastOrderSortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
  }

  return (
    <div className="overflow-x-auto rounded-3xl bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                aria-sort={
                  sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className={`px-4 py-3 font-medium ${col.numeric ? 'text-right' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(col.key)}
                  className="inline-flex items-center gap-1 hover:text-gray-900"
                >
                  {col.label}
                  {sort.key === col.key && <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((order) => {
            const ref =
              order.orderRef ||
              order.reference ||
              order.quoteNumber ||
              `#${order.orderId.slice(0, 8).toUpperCase()}`
            return (
              <tr key={order.orderId} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                  {new Date(order.createdAt).toLocaleDateString('en-NZ', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/my-collections/${order.quoteId ?? order.orderId}`}
                    className="font-semibold text-black hover:underline"
                  >
                    {ref}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{order.customerEmail ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{orderTypeLabel(order.orderType)}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {orderStatusLabel(order.status as OrderStatus)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCurrency(order.subtotal, order.currency)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatCurrency(order.billed, order.currency)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
