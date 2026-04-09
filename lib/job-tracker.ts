/**
 * Job Tracker Shared Types and Utilities
 *
 * Types and utilities used by both server queries and client components.
 */

export const STATUS_STEPS = [
  { key: 'quote-stage', label: 'Quote', tooltip: 'Initial quote captured' },
  { key: 'quote-accepted-mockup', label: 'Mockup', tooltip: 'Mockup in progress' },
  { key: 'need-proof', label: 'Proof Prep', tooltip: 'Proof is being prepared' },
  { key: 'proof-sent', label: 'Proof Sent', tooltip: 'Awaiting approval' },
  { key: 'proof-approved', label: 'Approved', tooltip: 'Proof approved' },
  { key: 'in-production', label: 'Production', tooltip: 'In production' },
  { key: 'dispatched', label: 'Dispatched', tooltip: 'Shipped or ready for pickup' },
]

export const STATUS_GUIDANCE: Record<string, { title: string; body: string }> = {
  'quote-stage': {
    title: 'Quote Stage',
    body: 'We have captured your quote and are preparing the details.',
  },
  'quote-accepted-mockup': {
    title: 'Mockup in Progress',
    body: 'Your quote has been accepted. Mockups are being prepared.',
  },
  'need-proof': {
    title: 'Preparing Proof',
    body: 'We are preparing your proof for review.',
  },
  'proof-sent': {
    title: 'Proof Sent',
    body: 'The proof has been sent. Please review and approve.',
  },
  'proof-approved': {
    title: 'Proof Approved',
    body: 'Your proof has been approved. Production will begin shortly.',
  },
  'in-production': {
    title: 'In Production',
    body: 'Your order is currently in production.',
  },
  'dispatched': {
    title: 'Dispatched',
    body: 'Your order has been dispatched. Check tracking for delivery updates.',
  },
  default: {
    title: 'Processing',
    body: 'Your order is being processed. Updates will appear here.',
  },
}

export interface TrackingInfo {
  number?: string
  url?: string
  carrier?: string
  changed_at?: string
}

export interface StatusHistoryEntry {
  id: string
  status: string
  status_key?: string
  previous_status?: string
  changed_at: string
  column_id?: string
  user_id?: string | null
}

export interface ProductionUpdate {
  id: string
  type: 'status' | 'note' | 'tracking' | 'milestone' | 'media'
  title: string
  body: string
  changed_at: string
  source: 'system' | 'user'
  metadata?: Record<string, unknown>
}

export interface JobTracker {
  id: string
  tracker_token: string
  job_reference: string | null
  monday_item_id: string | null
  quote_id: string | null
  monday_project_name: string | null
  quote_number: string | null
  customer_email: string | null
  customer_name: string | null
  user_id: string | null
  company_id: string | null
  location_id: string | null
  status: string
  tracking_info: TrackingInfo | null
  status_history: StatusHistoryEntry[]
  production_updates: ProductionUpdate[]
  estimated_delivery_at: string | null
  design_approval_at: string | null
  production_start_at: string | null
  production_complete_at: string | null
  product_images: string[]
  proof_files: Array<{ name: string; url: string }> | null
  quote_data: Record<string, unknown> | null
  created_at: string
  last_synced_at: string | null
  platform: string
}

export function getStatusStepIndex(status: string | null | undefined): number {
  if (!status) return -1

  const normalizedStatus = status.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  const index = STATUS_STEPS.findIndex((step) => step.key === normalizedStatus)
  if (index !== -1) return index

  const statusMappings: Record<string, string> = {
    'quote-received': 'quote-stage',
    'quote': 'quote-stage',
    'mockup': 'quote-accepted-mockup',
    'proof-needed': 'need-proof',
    'awaiting-approval': 'proof-sent',
    'approved': 'proof-approved',
    'production': 'in-production',
    'in-progress': 'in-production',
    'shipped': 'dispatched',
    'delivered': 'dispatched',
    'complete': 'dispatched',
    'fulfilled': 'dispatched',
  }

  const mappedStatus = statusMappings[normalizedStatus]
  if (mappedStatus) {
    return STATUS_STEPS.findIndex((step) => step.key === mappedStatus)
  }

  return -1
}

export function getStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'

  const stepIndex = getStatusStepIndex(status)
  if (stepIndex !== -1) {
    return STATUS_STEPS[stepIndex].label
  }

  return status
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getStatusGuidance(
  status: string | null | undefined
): { title: string; body: string } {
  if (!status) return STATUS_GUIDANCE.default

  const normalizedStatus = status.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return STATUS_GUIDANCE[normalizedStatus] || STATUS_GUIDANCE.default
}

export function getTrackerUrl(trackerToken: string): string {
  const base =
    process.env.NEXT_PUBLIC_TRACKER_BASE_URL ||
    'https://www.theprintroom.nz/apps/order-tracker'
  return `${base}/job/${trackerToken}`
}

export function detectCarrierFromUrl(url: string | undefined): string | null {
  if (!url) return null

  const urlLower = url.toLowerCase()

  if (urlLower.includes('nzpost') || urlLower.includes('trackme.nz'))
    return 'NZ Post'
  if (urlLower.includes('courierpost')) return 'CourierPost'
  if (urlLower.includes('ups.com')) return 'UPS'
  if (urlLower.includes('fedex.com')) return 'FedEx'
  if (urlLower.includes('dhl.com')) return 'DHL'
  if (urlLower.includes('auspost')) return 'Australia Post'
  if (urlLower.includes('aramex') || urlLower.includes('fastway'))
    return 'Aramex'

  return null
}
