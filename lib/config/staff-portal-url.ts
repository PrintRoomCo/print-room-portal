/**
 * Base URL of the internal staff portal (print-room-staff-portal).
 *
 * Staff-facing notifications — the order-placed dispatch email and Slack ping —
 * must deep-link HERE, at the order detail page staff can actually open, NOT the
 * customer portal (portal.theprintroom.nz), which would force a customer login.
 * Mirrors the STAFF_PORTAL_URL env convention already used by the proof pipeline
 * (lib/proofs/autofill-for-order.ts). Ships with a hardcoded production fallback
 * so links resolve even when no env var is set.
 */
const STAFF_PORTAL_FALLBACK = 'https://staff.theprintroom.nz'

/** Resolved staff-portal origin, trailing slashes stripped. */
export function staffPortalBaseUrl(): string {
  const raw =
    process.env.STAFF_PORTAL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    STAFF_PORTAL_FALLBACK
  return raw.replace(/\/+$/, '')
}

/** Absolute staff-portal deep link to an order's detail page (/orders/:id). */
export function staffOrderUrl(orderId: string): string {
  return `${staffPortalBaseUrl()}/orders/${orderId}`
}
