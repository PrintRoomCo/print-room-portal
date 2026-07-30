'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ProductionProgressBar } from '@/components/orders/ProductionProgressBar'
import { ProjectLineItem } from '@/components/orders/ProjectLineItem'
import { ReorderButton } from '@/components/orders/ReorderButton'
import { FulfilmentStatusBadge } from '@/components/orders/FulfilmentStatusBadge'
import { isStockOrder } from '@/lib/orders/fulfilment-status'
import type { JobTracker } from '@/lib/job-tracker'
import {
  STATUS_STEPS,
  getItemTotalQty,
  getStatusLabel,
  getPortalTrackerPath,
  getTrackingNumber,
  isTrackerCompleted,
} from '@/lib/job-tracker'
import {
  resolveStatusStepIndex,
  resolveStatusStepLabel,
} from '@/lib/job-tracker-status-display'
import { formatShippingAddress } from '@/lib/checkout/shipping-address'

interface JobTrackerOrderCardProps {
  tracker: JobTracker
  showCustomerEmail?: boolean
  /** Open expanded on first render (used by the single-order detail page). */
  defaultExpanded?: boolean
  /**
   * Hide the now-self-referential "View status" links. Set on the detail
   * page, which IS the full status view.
   */
  hideTrackerLink?: boolean
}

export function JobTrackerOrderCard({
  tracker,
  showCustomerEmail,
  defaultExpanded = false,
  hideTrackerLink = false,
}: JobTrackerOrderCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const completed = isTrackerCompleted(tracker.status)
  // Stock-on-hand orders (Anna feedback, Monday 2809663385): no production journey,
  // so the 7-step bar/timeline is replaced by a simple Unfulfilled/Fulfilled badge
  // and the "View status" links are suppressed. `completed` still drives Reorder vs
  // active, keyed off the SAME isTrackerCompleted the list filter uses — no drift.
  const stock = isStockOrder(tracker.order_type)
  const quoteData = tracker.quote_data ?? null
  const items = quoteData?.items ?? []
  const subtotal = quoteData?.summary?.total ?? quoteData?.summary?.subtotal ?? quoteData?.subtotal ?? 0
  const currency = quoteData?.currencyCode || 'NZD'
  const shippingAddressLines = formatShippingAddress(quoteData?.shippingAddress)?.split('\n') ?? []

  const trackerUrl = getPortalTrackerPath(tracker.tracker_token)
  const totalItems = items.reduce((sum, item) => sum + getItemTotalQty(item), 0)

  return (
    <div className="rounded-3xl bg-white overflow-hidden">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-6 text-left hover:bg-gray-50 transition-colors duration-300 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-black">
                  Project{' '}
                  {tracker.quote_number ||
                    tracker.job_reference ||
                    (tracker.monday_item_id ? `#${tracker.monday_item_id}` : 'Order')}
                </h3>
                {tracker.monday_project_name && (
                  <p className="text-sm text-gray-600 truncate">{tracker.monday_project_name}</p>
                )}
                {showCustomerEmail && tracker.customer_email && (
                  <p className="text-sm text-[rgb(var(--color-primary))] font-medium truncate">{tracker.customer_email}</p>
                )}
                <p className="text-sm text-black mt-0.5">
                  {new Date(tracker.created_at).toLocaleDateString('en-NZ', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
                {tracker.job_reference && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Ref: {tracker.job_reference}
                  </p>
                )}
              </div>

              <div className="text-right flex-shrink-0">
                <p className="font-semibold text-black">
                  ${subtotal.toFixed(2)}{' '}
                  <span className="text-black font-normal text-sm">{currency}</span>
                </p>
                <div className="flex gap-2 mt-2 justify-end">
                  {completed && <ReorderButton tracker={tracker} />}
                  {tracker.quote_id && (
                    <Link
                      href={`/my-collections/${tracker.quote_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 transition-all duration-150 hover:bg-gray-200 active:scale-[0.98]"
                    >
                      View Order
                    </Link>
                  )}
                  {/* Anna feedback (Monday 2809673375): a completed order shows the
                      Reorder button above instead of "View status". Active orders
                      keep the link into the live tracker. Stock orders have no
                      production status to view, so the link is suppressed for them. */}
                  {!hideTrackerLink && !completed && !stock && (
                    <Link
                      href={trackerUrl}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 transition-all duration-150 hover:bg-gray-200 active:scale-[0.98]"
                    >
                      View status
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* Summary Line */}
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <p className="text-sm text-black">
                  <span className="font-medium">
                    {items.length} product{items.length !== 1 ? 's' : ''}
                  </span>
                  {totalItems > 0 && (
                    <span className="text-black"> · {totalItems} total items</span>
                  )}
                </p>
              </div>

              <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200">
                <span>{isExpanded ? 'Hide' : 'Show'} details</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </div>

            {/* Progress — stock orders show a fulfilment badge; produced orders
                the 7-step production bar. */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              {stock ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-500">Status</span>
                  <FulfilmentStatusBadge trackerStatus={tracker.status} />
                </div>
              ) : (
                <ProductionProgressBar
                  currentStatus={tracker.status}
                  estimatedDelivery={tracker.estimated_delivery_at}
                  compact
                />
              )}
            </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-6 py-4">
          {/* Tracking Info */}
          {(() => {
            const displayNumber = getTrackingNumber(tracker.tracking_info)
            const trackingUrl = tracker.tracking_info?.url
            if (!displayNumber && !trackingUrl) return null
            return (
              <div className="mb-4 rounded-2xl bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[rgb(var(--color-brand-blue))]/10 border border-[rgb(var(--color-brand-blue))]/20 flex items-center justify-center">
                      <svg className="w-4 h-4 text-[rgb(var(--color-brand-blue))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {tracker.tracking_info?.carrier || 'Tracking'}
                      </p>
                      {displayNumber && (
                        <p className="text-xs text-gray-600">{displayNumber}</p>
                      )}
                    </div>
                  </div>
                  {trackingUrl && (
                    <a
                      href={trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 hover:bg-gray-200"
                    >
                      Track Package
                    </a>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Estimated Delivery */}
          {tracker.estimated_delivery_at && (
            <div className="mb-4 rounded-2xl bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-[rgb(var(--color-brand-blue))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-gray-600">Estimated Delivery:</span>
                <span className="text-sm font-medium text-gray-900">
                  {new Date(tracker.estimated_delivery_at).toLocaleDateString('en-NZ', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
          )}

          {/* Delivery Address */}
          {shippingAddressLines.length > 0 && (
            <div className="mb-4 rounded-2xl bg-gray-50 p-4">
              <h4 className="text-sm font-medium text-black mb-2">Delivery address</h4>
              <div className="space-y-0.5 text-sm text-gray-600">
                {shippingAddressLines.map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {/* Order Items */}
          {items.length > 0 ? (
            <>
              <h4 className="text-sm font-medium text-black mb-3">Items</h4>
              <div className="space-y-2">
                {items.map((item, index) => (
                  <ProjectLineItem
                    key={`${item.productId || item.productName || 'item'}-${index}`}
                    item={item}
                    designNamesByInstanceId={tracker.designNamesByInstanceId}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">
              No itemised products on record for this project — your account manager
              can reference the original order.
            </div>
          )}

          {/* Proof Files */}
          {tracker.proof_files && tracker.proof_files.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-black mb-2">Proof Files</h4>
              <div className="flex flex-wrap gap-2">
                {tracker.proof_files.map((file, index) => (
                  <a
                    key={index}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-900 transition-colors hover:bg-gray-200"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    {file.name || `Proof ${index + 1}`}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Status Timeline — produced orders only; stock orders show the
              fulfilment badge in the always-visible summary above. */}
          {!stock && tracker.status_history && tracker.status_history.length > 0 && (
            <StatusTimeline history={tracker.status_history} currentStatus={tracker.status} />
          )}

          {/* Full Tracker Link — hidden on completed and stock orders. */}
          {!hideTrackerLink && !completed && !stock && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <Link
                href={trackerUrl}
                className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-900 transition-colors hover:bg-gray-200"
              >
                View status
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusTimeline({
  history,
  currentStatus,
}: {
  history: Array<{ id: string; status: string; status_key?: string; changed_at: string }>
  currentStatus: string
}) {
  const historyByKey = new Map<string, { changed_at: string }>()
  ;[...history]
    .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())
    .forEach((entry) => {
      const key = (entry.status_key || entry.status).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      if (!historyByKey.has(key)) historyByKey.set(key, entry)
    })

  // Anna feedback (Monday 2809669100): the "current" step must come from the
  // tracker's live status — the SAME source the collapsed card's progress bar
  // uses — not from the furthest step ever recorded in history. Scanning history
  // for the max-reached step made this detail timeline disagree with the overview
  // whenever an order regressed (e.g. proof-approved → back to need-proof).
  const currentStepIndex = resolveStatusStepIndex(currentStatus)

  const currentEntry =
    currentStepIndex >= 0
      ? historyByKey.get(STATUS_STEPS[currentStepIndex].key)
      : null
  const currentLabel =
    currentStepIndex >= 0 ? resolveStatusStepLabel(currentStatus) : 'Not started'

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-gray-500">Status</span>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-900">
            {currentLabel}
          </span>
          {currentEntry && (
            <span className="text-xs tabular-nums text-gray-500">
              {new Date(currentEntry.changed_at).toLocaleDateString('en-NZ', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-1">
        {STATUS_STEPS.map((step, idx) => {
          const reached = idx <= currentStepIndex
          return (
            <span
              key={step.key}
              title={step.tooltip}
              className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                reached ? 'bg-gray-900' : 'bg-gray-100'
              }`}
            />
          )
        })}
      </div>

      <div className="mt-3 flex gap-1">
        {STATUS_STEPS.map((step, idx) => {
          const entry = historyByKey.get(step.key)
          const reached = idx <= currentStepIndex
          const isCurrent = idx === currentStepIndex
          return (
            <div
              key={step.key}
              className="flex flex-1 flex-col items-start gap-0.5 px-0.5"
            >
              <span
                className={`text-[11px] leading-tight ${
                  isCurrent
                    ? 'font-medium text-gray-900'
                    : reached
                      ? 'text-gray-500'
                      : 'text-gray-300'
                }`}
              >
                {getStatusLabel(step.key)}
              </span>
              {entry && (
                <span className="text-[10px] tabular-nums text-gray-400">
                  {new Date(entry.changed_at).toLocaleDateString('en-NZ', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
