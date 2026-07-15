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
