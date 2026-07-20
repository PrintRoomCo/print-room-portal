/**
 * Canonical Monday → tracker status engine (portal).
 *
 * Ported into typed portal code from the studio's
 *   - `print-room-studio/lib/monday-status-mappings.js`
 *   - `print-room-studio/apps/job-tracker/lib/status-transitions.js`
 * so the portal is the single processor of Monday Job-Status changes. This is
 * the one canonical status module in the portal; `lib/monday/status-mappings.ts`
 * is now a thin wrapper over `deriveStatusValue`.
 *
 * The 7 canonical keys are IDENTICAL to the portal's display steps in
 * `lib/job-tracker.ts` (STATUS_STEPS / STATUS_GUIDANCE), which stay the source
 * of truth for customer-facing labels. The engine only ever maps arbitrary
 * (untrusted) Monday labels onto that fixed key set — unknown labels are
 * ignored, never executed.
 *
 * The synonym table is built against the LIVE `color_mkpnas0e` board labels
 * (verified via the Monday API 2026-07-20), which fixes three labels the studio
 * table itself silently misses ("Sent: Mockup + Xero Quote",
 * "All Production Complete", "Mockup Complete") and suppresses every
 * "Lost Job - …" variant.
 */

import { STATUS_STEPS, STATUS_GUIDANCE } from '@/lib/job-tracker'

export const DEFAULT_CUSTOMER_STATUS_KEY = 'quote-stage'

export const CANONICAL_STATUS_KEYS: ReadonlySet<string> = new Set([
  'quote-stage',
  'quote-accepted-mockup',
  'need-proof',
  'proof-sent',
  'proof-approved',
  'in-production',
  'dispatched',
])

/**
 * Internal / sales-pipeline statuses that must never surface on the customer
 * tracker. Superset of the studio set + the live "Lost Job - …" variants the
 * studio table missed. See also the defensive prefix check in
 * `isNonCustomerFacingStatus`.
 */
export const NON_CUSTOMER_FACING_STATUS_KEYS: ReadonlySet<string> = new Set([
  'need-quote-offshore',
  'need-send-draft-quote',
  'sent-quote',
  'in-comms',
  'follow-up-1-sent',
  'follow-up-2-sent',
  'needs-follow-up',
  'replied',
  'lost-job-cost',
  'lost-job-time',
  'lost-job-no-reason',
  'lost-job-no-reply', // live idx 105 — studio missed
  'lost-job-we-made-it',
  'lost-job-under-review',
  'lost-job-under-moq', // live idx 156 — studio missed
  'lost-job-went-with-another-supplier', // live idx 152 — studio missed
  'lost-job-will-not-proceed-for-no-reason', // live idx 155 — studio missed
  'lost-job',
  'lost-incorrect-info',
])

/** Statuses that freeze the tracker at its current stage (no advance, no email). */
export const PRESERVE_PREVIOUS_STATUS_KEYS: ReadonlySet<string> = new Set(['job-on-hold'])

/**
 * Normalised-key → canonical-key synonym table. `null` explicitly suppresses a
 * key (internal / hold). Built against the LIVE board — the three "MISS" fixes
 * below are labels the studio table normalises differently and drops.
 */
export const BASE_STATUS_SYNONYMS: Record<string, string | null> = {
  // Stage 1: Quote stage
  quote: 'quote-stage',
  'quote-received': 'quote-stage',
  'quote-requested': 'quote-stage',
  'quote-stage': 'quote-stage',
  'yet-to-quote': 'quote-stage',
  'pending-quote': 'quote-stage',
  'quote-in-progress': 'quote-stage',
  'quote-draft': 'quote-stage',

  // Stage 2: Quote accepted & mockup request
  'quote-accepted': 'quote-accepted-mockup',
  'quote-accepted-mockup': 'quote-accepted-mockup',
  'need-mockup-quote-approved': 'quote-accepted-mockup',
  'mockup-completed': 'quote-accepted-mockup',
  'mockup-complete': 'quote-accepted-mockup', // live idx 14 — studio MISS
  'sent-mockup-and-xero-quote': 'quote-accepted-mockup',
  'sent-mockup-xero-quote': 'quote-accepted-mockup', // live idx 4 — studio MISS
  'open-for-preorders': 'quote-accepted-mockup',
  'mockup-request': 'quote-accepted-mockup',
  'mockup-sent': 'quote-accepted-mockup',

  // Stage 3: Proof is being prepared
  'need-proof': 'need-proof',
  'needs-proof': 'need-proof',
  'proof-needed': 'need-proof',
  'proof-required': 'need-proof',
  'awaiting-proof': 'need-proof',
  'pending-proof': 'need-proof',
  'proof-in-progress': 'need-proof',
  'preparing-proof': 'need-proof',
  'need-internal-proof-approval': 'need-proof',
  'need-send-proof-invoice-quote-from-xero': 'need-proof',
  'proof-declined': 'need-proof',
  'artwork-proof-edits': 'need-proof',

  // Stage 4: Proof sent for approval
  'proof-sent': 'proof-sent',
  'proof-sent-for-approval': 'proof-sent',
  'sent-proof-invoice': 'proof-sent',
  'sent-proof-invoice-quote': 'proof-sent',
  'awaiting-approval': 'proof-sent',
  'awaiting-customer-feedback': 'proof-sent',
  'awaiting-signoff': 'proof-sent',
  'awaiting-sign-off': 'proof-sent',
  'awaiting-customer': 'proof-sent',
  'awaiting-client': 'proof-sent',

  // Stage 5: Proof approved
  'proof-approved': 'proof-approved',
  'proof-approved-pre-production': 'proof-approved',
  'proof-approved-preproduction': 'proof-approved',
  'stock-ordered': 'proof-approved',

  // Stage 6: In production
  'assign-to-production': 'in-production',
  'assign-to-production-status': 'in-production',
  'assigned-to-production': 'in-production',
  'all-production-started': 'in-production',
  'all-production-complete': 'in-production', // live idx 9 — studio MISS
  'trends-ordered': 'in-production',
  'in-production': 'in-production',
  'production-started': 'in-production',
  'production-in-progress': 'in-production',
  'in-progress': 'in-production',
  inprogress: 'in-production',
  production: 'in-production',
  'partially-shipped': 'in-production',

  // Stage 7: Dispatched
  dispatched: 'dispatched',
  shipped: 'dispatched',
  'ready-to-pickup': 'dispatched',
  'pr-warehouse': 'dispatched',
  'ship-direct-to-client': 'dispatched',
  'closed-job': 'dispatched',
  '3pl-fulfillment': 'dispatched',
  fulfilled: 'dispatched',
  pickup: 'dispatched',

  // Explicitly suppress internal / hold statuses from any lookup.
  'need-quote-offshore': null,
  'need-send-draft-quote': null,
  'sent-quote': null,
  'in-comms': null,
  'follow-up-1-sent': null,
  'follow-up-2-sent': null,
  'needs-follow-up': null,
  replied: null,
  'lost-job-cost': null,
  'lost-job-time': null,
  'lost-job-no-reason': null,
  'lost-job-no-reply': null,
  'lost-job-we-made-it': null,
  'lost-job-under-review': null,
  'lost-job-under-moq': null,
  'lost-job-went-with-another-supplier': null,
  'lost-job-will-not-proceed-for-no-reason': null,
  'lost-job': null,
  'lost-incorrect-info': null,
  'job-on-hold': null,
}

const STATUS_STEP_LOOKUP = new Map(STATUS_STEPS.map((step) => [step.key, step]))

export function normalizeKey(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getStatusStep(
  key: string | null
): { key: string; label: string; tooltip: string } | null {
  if (!key) return null
  return STATUS_STEP_LOOKUP.get(key) ?? null
}

/**
 * Internal / non-customer-facing status? True for the explicit set AND — as a
 * defensive net against staff adding new "Lost Job - X" / "Lost - X" labels —
 * any key beginning `lost-job` or `lost-incorrect`. This guarantees a lost sale
 * can never leak onto a customer's tracker or trigger an email.
 */
export function isNonCustomerFacingStatus(statusText: string | null | undefined): boolean {
  const normalized = normalizeKey(statusText)
  if (!normalized) return false
  return (
    NON_CUSTOMER_FACING_STATUS_KEYS.has(normalized) ||
    normalized.startsWith('lost-job') ||
    normalized.startsWith('lost-incorrect')
  )
}

export function shouldPreservePreviousStatus(statusText: string | null | undefined): boolean {
  const normalized = normalizeKey(statusText)
  return Boolean(
    normalized &&
      (isNonCustomerFacingStatus(statusText) || PRESERVE_PREVIOUS_STATUS_KEYS.has(normalized))
  )
}

export interface MondayStatusMapping {
  canonical: string | null
  normalized: string | null
  isCustomerFacing: boolean
  isInternalOnly: boolean
  preservePrevious: boolean
}

export function mapMondayStatus(statusText: string | null | undefined): MondayStatusMapping {
  const normalized = normalizeKey(statusText)
  if (!normalized) {
    return {
      canonical: null,
      normalized: null,
      isCustomerFacing: false,
      isInternalOnly: false,
      preservePrevious: false,
    }
  }

  const isInternalOnly = isNonCustomerFacingStatus(statusText)
  const preservePrevious = isInternalOnly || PRESERVE_PREVIOUS_STATUS_KEYS.has(normalized)

  if (CANONICAL_STATUS_KEYS.has(normalized)) {
    return { canonical: normalized, normalized, isCustomerFacing: true, isInternalOnly, preservePrevious }
  }

  const synonym = BASE_STATUS_SYNONYMS[normalized]
  return {
    canonical: typeof synonym === 'string' ? synonym : null,
    normalized,
    isCustomerFacing: typeof synonym === 'string',
    isInternalOnly,
    preservePrevious,
  }
}

function normalizeInput(value: string | null | undefined): string | null {
  if (value === null || typeof value === 'undefined') return null
  const stringValue = typeof value === 'string' ? value.trim() : String(value).trim()
  return stringValue || null
}

function resolveCanonicalCustomerStatusKey(value: string | null | undefined): string | null {
  const stringValue = normalizeInput(value)
  if (!stringValue) return null
  const mapping = mapMondayStatus(stringValue)
  if (mapping.canonical) return mapping.canonical
  const normalized = normalizeKey(stringValue)
  return getStatusStep(normalized) ? normalized : null
}

export function resolveStatusKey(value: string | null | undefined): string | null {
  const stringValue = normalizeInput(value)
  if (!stringValue) return null
  const mapping = mapMondayStatus(stringValue)
  return mapping.canonical || mapping.normalized || normalizeKey(stringValue)
}

export interface DerivedStatus {
  key: string | null
  storageValue: string | null
  display: string | null
  raw: string | null
  normalized: string | null
  canonical: string | null
  isCustomerFacing: boolean
  preserveExisting: boolean
}

export function deriveStatusValue(
  value: string | null | undefined,
  { previousStatus = null, fallbackKey = DEFAULT_CUSTOMER_STATUS_KEY }: { previousStatus?: string | null; fallbackKey?: string } = {}
): DerivedStatus {
  const stringValue = normalizeInput(value)
  if (!stringValue) {
    return {
      key: null,
      storageValue: null,
      display: null,
      raw: null,
      normalized: null,
      canonical: null,
      isCustomerFacing: false,
      preserveExisting: false,
    }
  }

  const mapping = mapMondayStatus(stringValue)
  const normalized = mapping.normalized || normalizeKey(stringValue)
  const preservedKey = mapping.preservePrevious
    ? resolveCanonicalCustomerStatusKey(previousStatus) || fallbackKey || null
    : null
  const effectiveKey = preservedKey || mapping.canonical || normalized || null
  const canonicalStep = getStatusStep(effectiveKey)
  const display = canonicalStep ? canonicalStep.label : stringValue

  return {
    key: effectiveKey,
    storageValue: canonicalStep ? effectiveKey : stringValue,
    display: display || stringValue,
    raw: stringValue,
    normalized,
    canonical: mapping.canonical || (canonicalStep ? effectiveKey : null),
    isCustomerFacing: Boolean(canonicalStep) && !mapping.preservePrevious,
    preserveExisting: Boolean(mapping.preservePrevious),
  }
}

export function getCustomerFacingStatusCopy(
  value: string | null | undefined,
  options: { previousStatus?: string | null; fallbackKey?: string } = {}
): DerivedStatus & { title: string; body: string } {
  const derived = deriveStatusValue(value, options)
  const guidance = derived.key ? STATUS_GUIDANCE[derived.key] : null
  return {
    ...derived,
    title: guidance?.title || derived.display || STATUS_GUIDANCE.default.title,
    body: guidance?.body || derived.display || STATUS_GUIDANCE.default.body,
  }
}

export function statusesMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const leftKey = resolveStatusKey(left)
  const rightKey = resolveStatusKey(right)
  if (!leftKey && !rightKey) return true
  return leftKey === rightKey
}
