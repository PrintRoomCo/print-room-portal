/**
 * Customer-facing fulfilment status for STOCK-ON-HAND orders.
 * Sprint 3, Anna portal feedback — Monday 2809663385.
 *
 * Chris: "For status of Stock orders, could it be unfulfilled/fulfilled? … Status'
 * aren't relevant to them." Pure stock orders ship from the shelf — the 7-step
 * production journey (proof → production → dispatch) is meaningless — so for these
 * orders we collapse status to a simple two-state badge.
 *
 * DISPLAY ONLY and ORDER-SCOPED. Detection keys off the persisted `order_type`:
 * checkout splits mixed carts into homogeneous orders (lib/checkout/partition.ts),
 * so a WHOLE order is stock ⟺ order_type === 'stock_on_hand'. No schema change,
 * no per-line inspection.
 *
 * "Fulfilled" reuses the SAME terminal notion the tracker's Active/Past filter and
 * summary counts use (`isTrackerCompleted`), so a stock order flips to Fulfilled in
 * lock-step with the tracker card — the surfaces never disagree. It also honours the
 * order-grain `orders.status` terminal values ('fulfilled' / 'shipped'), whichever
 * system moves the order first.
 */
import { isTrackerCompleted } from '@/lib/job-tracker'

export type FulfilmentStatus = 'fulfilled' | 'unfulfilled' | 'cancelled'

/** A whole order is stock-only ⟺ its persisted order_type is 'stock_on_hand'. */
export function isStockOrder(orderType: string | null | undefined): boolean {
  return orderType === 'stock_on_hand'
}

export interface FulfilmentInputs {
  /** orders.status (order-grain). Present on the order-history surfaces. */
  orderStatus?: string | null
  /** job_trackers.status for the order's quote — the reliable "did it ship" mover. */
  trackerStatus?: string | null
}

/**
 * Collapse whatever status signals exist into the two-state (plus cancelled)
 * fulfilment view. Precedence: an explicit cancel wins; then any terminal order-
 * or tracker-grade signal means Fulfilled; otherwise the order is still Unfulfilled
 * (every in-flight production state maps here).
 */
export function deriveFulfilmentStatus(inputs: FulfilmentInputs): FulfilmentStatus {
  const orderStatus = inputs.orderStatus?.trim().toLowerCase()
  if (orderStatus === 'cancelled') return 'cancelled'
  if (orderStatus === 'fulfilled' || orderStatus === 'shipped') return 'fulfilled'
  if (isTrackerCompleted(inputs.trackerStatus)) return 'fulfilled'
  return 'unfulfilled'
}

export function fulfilmentStatusLabel(status: FulfilmentStatus): string {
  switch (status) {
    case 'fulfilled':
      return 'Fulfilled'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unfulfilled'
  }
}
