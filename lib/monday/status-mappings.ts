/**
 * Monday.com Status Mappings
 *
 * Maps between Monday status labels/indices and our internal statuses.
 */

// --- Collection status mappings (board 5025641710) ---

export type CollectionMondayStatus = 'pending_review' | 'approved' | 'rejected'

/**
 * Map a Monday status label + index to our collection status.
 * Tries text first, falls back to index.
 */
export function mapMondayToCollectionStatus(
  labelIndex: number | undefined,
  labelText: string | undefined
): CollectionMondayStatus | null {
  const normalized = (labelText || '').toLowerCase().trim()

  if (normalized) {
    if (['done', 'approved', 'complete', 'completed'].includes(normalized)) {
      return 'approved'
    }
    if (['stuck', 'rejected', 'declined', 'failed'].includes(normalized)) {
      return 'rejected'
    }
    if (
      ['working on it', 'pending review', 'pending', 'in progress', 'review'].includes(normalized)
    ) {
      return 'pending_review'
    }
  }

  // Fall back to index-based mapping
  switch (labelIndex) {
    case 0:
      return 'pending_review'
    case 1:
      return 'approved'
    case 2:
      return 'rejected'
    default:
      return null
  }
}

// --- Quick Quote status mappings (quotes board) ---

export type QuickQuoteEvent =
  | 'approve-quote'
  | 'reject-quote'
  | 'proof-ready'
  | 'proof-sent'
  | 'proof-approved'

export function mapMondayToQuickQuoteEvent(
  labelText: string | undefined
): QuickQuoteEvent | null {
  const normalized = (labelText || '').toLowerCase().trim()
  if (!normalized) return null

  if (['approved', 'quote approved', 'customer approved', 'done'].includes(normalized)) {
    return 'approve-quote'
  }
  if (['rejected', 'quote rejected', 'declined', 'changes requested', 'stuck'].includes(normalized)) {
    return 'reject-quote'
  }
  if (['need proof', 'proof prep', 'proof ready'].includes(normalized)) {
    return 'proof-ready'
  }
  if (['proof sent', 'awaiting proof approval', 'awaiting approval'].includes(normalized)) {
    return 'proof-sent'
  }
  if (['proof approved', 'approved proof'].includes(normalized)) {
    return 'proof-approved'
  }

  return null
}

// --- Tracker status mappings ---

import { STATUS_STEPS } from '@/lib/job-tracker'

/**
 * Map a Monday status label to a job tracker status step.
 * Returns null if no match.
 */
export function mapMondayToTrackerStatus(labelText: string | undefined): string | null {
  const normalized = (labelText || '').toLowerCase().trim()
  if (!normalized) return null

  const mapping: Record<string, string> = {
    'quote received': 'quote-stage',
    'quote stage': 'quote-stage',
    'quote accepted': 'quote-accepted-mockup',
    'mockup': 'quote-accepted-mockup',
    'need proof': 'need-proof',
    'proof prep': 'need-proof',
    'proof sent': 'proof-sent',
    'awaiting proof': 'proof-sent',
    'proof approved': 'proof-approved',
    'in production': 'in-production',
    'production': 'in-production',
    'dispatched': 'dispatched',
    'shipped': 'dispatched',
    'delivered': 'dispatched',
  }

  const mapped = mapping[normalized]
  if (mapped && STATUS_STEPS.some((s) => s.key === mapped)) {
    return mapped
  }

  return null
}
