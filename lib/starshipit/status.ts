// lib/starshipit/status.ts
// Mirrors print-room-studio/apps/job-tracker/lib/starshipit.js STATUS_MAP.
const STATUS_MAP: Record<string, { label: string; category: string }> = {
  Printed: { label: 'Label Printed', category: 'pre-transit' },
  Dispatched: { label: 'Dispatched', category: 'in-transit' },
  InTransit: { label: 'In Transit', category: 'in-transit' },
  OutForDelivery: { label: 'Out for Delivery', category: 'out-for-delivery' },
  Delivered: { label: 'Delivered', category: 'delivered' },
  PickupInStore: { label: 'Ready for Pickup', category: 'delivered' },
  AttemptedDelivery: { label: 'Delivery Attempted', category: 'exception' },
  Exception: { label: 'Exception', category: 'exception' },
  AwaitingCollection: { label: 'Awaiting Collection', category: 'in-transit' },
  Cancelled: { label: 'Cancelled', category: 'cancelled' },
}

export function mapStarshipitStatus(status: string | undefined): { label: string; category: string } {
  return (status && STATUS_MAP[status]) || { label: status || 'Unknown', category: 'unknown' }
}

// Vocabulary of order_shipments.status (staff-portal migration
// 20260804110000_order_fulfillment_foundation.sql CHECK constraint).
export type ParcelStatus =
  | 'pending'
  | 'label_printed'
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'cancelled'

const PARCEL_STATUS_MAP: Record<string, ParcelStatus> = {
  Printed: 'label_printed',
  Dispatched: 'dispatched',
  InTransit: 'in_transit',
  AwaitingCollection: 'in_transit',
  OutForDelivery: 'out_for_delivery',
  Delivered: 'delivered',
  PickupInStore: 'delivered',
  AttemptedDelivery: 'exception',
  Exception: 'exception',
  Cancelled: 'cancelled',
}

/** Null means "don't write a parcel for this event" — the caller logs the skip. */
export function toParcelStatus(trackingStatus: string | undefined): ParcelStatus | null {
  return (trackingStatus && PARCEL_STATUS_MAP[trackingStatus]) || null
}
