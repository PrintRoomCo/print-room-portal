/** Absolute server-side ceiling for a custom name, regardless of per-product cap. */
export const MAX_CUSTOM_NAME_LENGTH = 30

// Letters (any script), digits, space, and the embroidery/print-safe punctuation
// - ' . , — everything else is stripped. Unicode-aware so macrons etc. survive.
const DISALLOWED = /[^\p{L}\p{N} .,'\-]/gu

/**
 * Normalise an optional PDP custom name. Used on both the client (PDP add) and
 * the server (checkout route defence). Empty-after-sanitise → null so blank
 * names merge; case is preserved (embroidery renders "Chris" ≠ "CHRIS", so they
 * stay distinct cart lines). Clamped to the per-product cap, falling back to the
 * 30-char ceiling when the cap is absent/invalid.
 */
export function sanitiseCustomName(
  raw: string | null | undefined,
  maxLength: number | null | undefined,
): string | null {
  if (raw == null) return null
  let s = String(raw).replace(DISALLOWED, '')
  s = s.replace(/\s+/g, ' ').trim()
  if (s === '') return null
  const cap =
    typeof maxLength === 'number' && maxLength > 0 && maxLength <= MAX_CUSTOM_NAME_LENGTH
      ? Math.trunc(maxLength)
      : MAX_CUSTOM_NAME_LENGTH
  if (s.length > cap) s = s.slice(0, cap).trim()
  return s === '' ? null : s
}
