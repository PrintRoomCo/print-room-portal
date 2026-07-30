/**
 * Display-side status → step resolution for the customer order tracker.
 *
 * Single source of truth for "which of the 7 STATUS_STEPS is this raw status
 * on?" It delegates to the canonical Monday synonym engine (`resolveStatusKey`),
 * so the RENDER path recognises the same ~60 raw labels the ingest/webhook path
 * does. This supersedes the hand-rolled 12-entry table in
 * `lib/job-tracker.ts#getStatusStepIndex`, which had drifted from the engine —
 * that drift let unmapped labels (e.g. "preparing-proof") fall through to raw
 * title-cased text and let the overview card and the detail timeline disagree
 * about the current step (Anna feedback, Monday 2809669100).
 *
 * Lives in its own leaf module because `lib/job-tracker.ts` cannot import the
 * engine — the engine imports STATUS_STEPS from job-tracker, so importing back
 * would be a cycle. Tracker components import from here instead.
 */
import { STATUS_STEPS, getStatusLabel } from '@/lib/job-tracker'
import { resolveStatusKey } from '@/lib/monday/tracker-status-engine'

/** Index into STATUS_STEPS for a raw/canonical status, or -1 if unrecognised. */
export function resolveStatusStepIndex(status: string | null | undefined): number {
  const key = resolveStatusKey(status)
  if (!key) return -1
  return STATUS_STEPS.findIndex((step) => step.key === key)
}

/**
 * Customer-facing label for a raw/canonical status: the canonical step label
 * when the status maps onto a step, otherwise the title-cased fallback (which
 * preserves prior behaviour for genuinely unknown labels).
 */
export function resolveStatusStepLabel(status: string | null | undefined): string {
  const index = resolveStatusStepIndex(status)
  return index >= 0 ? STATUS_STEPS[index].label : getStatusLabel(status)
}
