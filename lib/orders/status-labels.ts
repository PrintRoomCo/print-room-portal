/**
 * Canonical order-status labels.
 *
 * Source of truth for human-readable strings of the Supabase `order_status`
 * enum. Created 2026-05-21 alongside the enum extension for the
 * Checkout → Monday → Auto-Proof pipeline.
 *
 * The hand-rolled union below mirrors `enum_range(NULL::order_status)` as of
 * migration `20260521000000_orders_status_proof_review_states`. If/when
 * generated Supabase types are added to this repo, switch to:
 *   import type { Database } from '@/types/supabase'
 *   export type OrderStatus = Database['public']['Enums']['order_status']
 *
 * Existing inline status maps (e.g. `QuoteStatusChip` in
 * `app/(portal)/my-collections/[collectionId]/page.tsx`) will be
 * consolidated to import from this file in a follow-up pass.
 */

export type OrderStatus =
  | 'awaiting-approval'
  | 'approved'
  | 'awaiting-production'
  | 'in-production'
  | 'fulfilled'
  | 'shipped'
  | 'cancelled'
  // New (2026-05-21)
  | 'awaiting-proof-review'
  | 'awaiting-customer-approval'
  // New (2026-06-11) — pre-order: order received, price frozen when window closes
  | 'awaiting-period-close'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  'awaiting-approval': 'Awaiting approval',
  approved: 'Approved',
  'awaiting-production': 'Queued for production',
  'in-production': 'In production',
  fulfilled: 'Fulfilled',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
  // New (2026-05-21)
  'awaiting-proof-review': 'Preparing proof',
  'awaiting-customer-approval': 'Proof ready — review on your order page',
  // New (2026-06-11)
  'awaiting-period-close': 'Received — price confirmed when your ordering window closes',
}

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? status
}
