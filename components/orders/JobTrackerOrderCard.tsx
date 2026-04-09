'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ProductionProgressBar } from '@/components/orders/ProductionProgressBar'
import type { JobTracker } from '@/lib/job-tracker'
import { getTrackerUrl, getStatusLabel, getStatusGuidance } from '@/lib/job-tracker'

interface QuoteDataItem {
  productTitle: string
  variantTitle?: string
  quantity: number
  price: { amount: string; currencyCode: string }
  image?: { url: string; altText?: string }
  selectedOptions?: Array<{ name: string; value: string }>
}

interface QuoteData {
  items?: QuoteDataItem[]
  subtotal?: number
  currencyCode?: string
  shippingAddress?: {
    city?: string
    country?: string
  }
}

interface JobTrackerOrderCardProps {
  tracker: JobTracker
  showCustomerEmail?: boolean
}

export function JobTrackerOrderCard({ tracker, showCustomerEmail }: JobTrackerOrderCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const quoteData = tracker.quote_data as QuoteData | null
  const items = quoteData?.items || []
  const subtotal = quoteData?.subtotal || 0
  const currency = quoteData?.currencyCode || 'NZD'
  const firstItem = items[0]

  const getOrderImage = (): string | undefined => {
    if (tracker.product_images && tracker.product_images.length > 0) {
      return tracker.product_images[0]
    }
    if (firstItem?.image?.url) {
      return firstItem.image.url
    }
    return undefined
  }

  const orderImage = getOrderImage()
  const trackerUrl = getTrackerUrl(tracker.tracker_token)
  const totalItems = items.reduce((sum, item) => sum + (item.quantity || 0), 0)

  return (
    <div className="card-elevated overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-6 text-left hover:bg-gray-50 transition-colors duration-300"
      >
        <div className="flex gap-6">
          {/* Product Image */}
          <div className="w-24 h-24 bg-gray-100/50 rounded-xl overflow-hidden flex-shrink-0 border border-gray-100">
            {orderImage ? (
              <img
                src={orderImage}
                alt={firstItem?.productTitle || 'Order'}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Order Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-black">
                  Order {tracker.quote_number || `#${tracker.monday_item_id || tracker.tracker_token}`}
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
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">
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
                  {tracker.quote_id && (
                    <Link
                      href={`/my-collections/${tracker.quote_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="btn-secondary"
                    >
                      View Quote
                    </Link>
                  )}
                  {trackerUrl && (
                    <a
                      href={trackerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="btn-primary"
                    >
                      Track Order
                    </a>
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

              <div className="flex items-center gap-2 text-black">
                <span className="text-xs">{isExpanded ? 'Hide' : 'Show'} details</span>
                <svg
                  className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <ProductionProgressBar
                currentStatus={tracker.status}
                estimatedDelivery={tracker.estimated_delivery_at}
                compact
              />
            </div>
          </div>
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-4">
          {/* Tracking Info */}
          {tracker.tracking_info?.number && (
            <div className="mb-4 p-3 glass-chip">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[rgb(var(--color-brand-blue))]/10 border border-[rgb(var(--color-brand-blue))]/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-[rgb(var(--color-brand-blue))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {tracker.tracking_info.carrier || 'Tracking'}
                    </p>
                    <p className="text-xs text-gray-600 font-mono">
                      {tracker.tracking_info.number}
                    </p>
                  </div>
                </div>
                {tracker.tracking_info.url && (
                  <a
                    href={tracker.tracking_info.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-sm"
                  >
                    Track Package
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Estimated Delivery */}
          {tracker.estimated_delivery_at && (
            <div className="mb-4 p-3 glass-success-box">
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

          {/* Order Items */}
          {items.length > 0 && (
            <>
              <h4 className="text-sm font-medium text-black mb-3">Order Items</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {items.map((item, index) => (
                  <div
                    key={`${item.productTitle}-${index}`}
                    className="glass-chip overflow-hidden"
                  >
                    <div className="aspect-square bg-gray-100/50">
                      {item.image?.url ? (
                        <img
                          src={item.image.url}
                          alt={item.image.altText || item.productTitle}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium text-black line-clamp-2 leading-tight">
                        {item.productTitle}
                      </p>
                      {item.variantTitle && (
                        <p className="text-xs text-gray-500 truncate">{item.variantTitle}</p>
                      )}
                      <p className="text-xs text-black mt-1">Qty: {item.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
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
                    className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200"
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

          {/* Status Timeline */}
          {tracker.status_history && tracker.status_history.length > 0 && (
            <StatusTimeline history={tracker.status_history} />
          )}

          {/* Full Tracker Link */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <a
              href={trackerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-[rgb(var(--color-primary))] hover:text-[rgb(var(--color-primary-dark))] transition-colors"
            >
              View Full Order Tracker
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusTimeline({
  history,
}: {
  history: Array<{ id: string; status: string; status_key?: string; changed_at: string }>
}) {
  const sorted = [...history].sort(
    (a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()
  )

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium text-black mb-3">Status Timeline</h4>
      <div className="relative pl-6">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[rgb(var(--color-brand-blue))]/20" />

        <div className="space-y-4">
          {sorted.map((entry, index) => {
            const statusKey = entry.status_key || entry.status
            const label = getStatusLabel(statusKey)
            const guidance = getStatusGuidance(statusKey)
            const isLatest = index === 0

            return (
              <div key={entry.id} className="relative">
                <div
                  className={`absolute -left-6 top-0.5 w-3.5 h-3.5 rounded-full border-2 ${
                    isLatest
                      ? 'bg-[rgb(var(--color-brand-blue))] border-[rgb(var(--color-brand-blue))]/30 shadow-sm shadow-[rgb(var(--color-brand-blue))]/20'
                      : 'bg-[rgb(var(--color-brand-yellow))] border-[rgb(var(--color-brand-blue))]/15'
                  }`}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        isLatest ? 'text-[rgb(var(--color-brand-blue))]' : 'text-gray-600'
                      }`}
                    >
                      {label}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(entry.changed_at).toLocaleDateString('en-NZ', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{guidance.body}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
