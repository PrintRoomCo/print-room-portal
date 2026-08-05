// lib/starshipit/ready-to-dispatch.ts
//
// Which RAW Monday production labels mean "job complete — ready for a courier
// ticket" (design D4, trigger resolved in the 2026-08-06 plan). Mirrors
// lib/email/milestone-email.ts: keyed on the raw label, deliberately narrower
// than tracker-status-engine's canonical buckets — the 'dispatched' bucket
// ("Shipped", "Closed Job", ...) is too late (the ticket must print BEFORE
// shipping) and "Assign to Production" is too early.

const READY_TO_DISPATCH_LABELS: ReadonlySet<string> = new Set([
  'all-production-complete',
])

function normalizeKey(label: string | null | undefined): string | null {
  if (typeof label !== 'string') return null
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return key.length > 0 ? key : null
}

export function isReadyToDispatchLabel(label: string | null | undefined): boolean {
  const key = normalizeKey(label)
  return key != null && READY_TO_DISPATCH_LABELS.has(key)
}
