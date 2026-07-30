import {
  deriveFulfilmentStatus,
  fulfilmentStatusLabel,
  type FulfilmentInputs,
  type FulfilmentStatus,
} from '@/lib/orders/fulfilment-status'

const STYLES: Record<FulfilmentStatus, string> = {
  fulfilled: 'bg-emerald-50 text-emerald-700',
  unfulfilled: 'bg-amber-50 text-amber-800',
  cancelled: 'bg-gray-100 text-gray-500',
}

interface FulfilmentStatusBadgeProps extends FulfilmentInputs {
  className?: string
}

/**
 * Two-state (Unfulfilled → Fulfilled, plus Cancelled) pill for stock-on-hand
 * orders. Callers gate on `isStockOrder()` and pass whatever status signals they
 * hold (order-grain `orderStatus`, tracker-grain `trackerStatus`, or both). See
 * lib/orders/fulfilment-status.ts.
 */
export function FulfilmentStatusBadge({
  orderStatus,
  trackerStatus,
  className = '',
}: FulfilmentStatusBadgeProps) {
  const status = deriveFulfilmentStatus({ orderStatus, trackerStatus })
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]} ${className}`.trim()}
    >
      {fulfilmentStatusLabel(status)}
    </span>
  )
}
