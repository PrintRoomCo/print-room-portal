/**
 * Milestone email gate (portal).
 *
 * The order-tracker webhook advances the customer tracker on EVERY customer-
 * facing Monday transition, but the customer is only *emailed* at two moments:
 * "in production" and "shipped". This module is the single source of truth for
 * that allow-list.
 *
 * The gate keys on the RAW Monday Job-Status label, NOT the canonical status,
 * because the canonical buckets are deliberately coarse: canonical
 * `in-production` also swallows "Partially Shipped" / "Trends - Ordered", and
 * canonical `dispatched` swallows "Closed Job" / "Ready to Pickup" / "Ship
 * Direct to Client" — none of which should trigger a customer email. See
 * `lib/monday/tracker-status-engine.ts` for the full canonical map.
 */

import { normalizeKey } from '@/lib/monday/tracker-status-engine'

export type MilestoneKey = 'in-production' | 'dispatched'

/**
 * Normalised Monday labels that fire the "in production" email. Both map to
 * canonical `in-production`; staff use "All Production Complete" about as often
 * as "Assign to Production" (some jobs skip straight to Complete), so we fire on
 * whichever lands FIRST and de-dup once-ever downstream. "Partially Shipped" is
 * deliberately excluded — it means shipping has begun, not that work started.
 */
const IN_PRODUCTION_LABELS: ReadonlySet<string> = new Set([
  'assign-to-production',
  'all-production-complete',
])

/**
 * Normalised Monday labels that fire the "shipped" email. Only "Shipped" — not
 * "Closed Job" (fires AFTER Shipped and is the most frequent board value),
 * "Ready to Pickup" or "Ship Direct to Client" (pickup ≠ shipped copy).
 */
const DISPATCHED_LABELS: ReadonlySet<string> = new Set(['shipped'])

/**
 * Map a raw Monday Job-Status label to the milestone email it should fire, or
 * `null` for every other label (the tracker still updates silently). Case- and
 * punctuation-insensitive via `normalizeKey`.
 */
export function milestoneForLabel(
  displayLabel: string | null | undefined
): MilestoneKey | null {
  const key = normalizeKey(displayLabel)
  if (!key) return null
  if (IN_PRODUCTION_LABELS.has(key)) return 'in-production'
  if (DISPATCHED_LABELS.has(key)) return 'dispatched'
  return null
}

/**
 * Stable de-dup key for a milestone email — `milestone-<key>`. Unlike the old
 * per-transition key, this does NOT encode the Monday trigger time, so a
 * re-entry to the milestone after a hold/rework (Assign to Production → Job on
 * Hold → Assign to Production) does not re-notify: the email lands once ever.
 */
export function milestoneEmailType(milestone: MilestoneKey): string {
  return `milestone-${milestone}`
}
