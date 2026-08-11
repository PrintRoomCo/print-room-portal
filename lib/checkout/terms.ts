/**
 * Single source of the Terms & Conditions version string. Imported by the
 * client only: the client rendered the exact text the customer saw, so it is
 * the authoritative source of the recorded version (design 2026-08-11).
 *
 * Format: `v<sequence>-<effective-date>`. Bump the sequence (v2, v3, …) on any
 * SUBSTANTIVE change to `TermsContent.tsx` (not typo fixes) and set the date to
 * the day the new copy goes live. The string is git-versioned alongside
 * `TermsContent.tsx`, so any recorded value resolves back to real text.
 */
export const TERMS_VERSION = 'v1-2026-08-11'
