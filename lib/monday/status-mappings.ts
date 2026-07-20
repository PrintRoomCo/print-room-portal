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

import { deriveStatusValue } from '@/lib/monday/tracker-status-engine'

/**
 * Map a Monday status label to a customer-facing job-tracker stage key.
 * Thin wrapper over the canonical engine (see tracker-status-engine.ts): returns
 * the canonical key for a customer-facing label, or null for internal / hold /
 * unknown labels. Replaces the old 14-row stub that recognised ~2 of ~40 real
 * board labels (issue #77, Gate 2).
 */
export function mapMondayToTrackerStatus(labelText: string | undefined): string | null {
  const derived = deriveStatusValue(labelText ?? null)
  return derived.isCustomerFacing ? derived.canonical : null
}
