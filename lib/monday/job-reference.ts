/**
 * Job-reference validation (portal).
 *
 * Verbatim port of `print-room-studio/apps/job-tracker/src/server/job-tracker/
 * job-reference.js`. A Monday-origin tracker uses its validated job reference as
 * BOTH `job_reference` and `tracker_token`, so the format is enforced before any
 * provisioning write.
 */

export const JOB_REFERENCE_PATTERN = /^[A-Za-z]{2,}[-_]\d{2,}(?:[-_]\d+)?$/
export const JOB_REFERENCE_EXAMPLE = 'NEOC-3781'

export function normalizeJobReference(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

export type JobReferenceValidation =
  | { ok: true; value: string }
  | { ok: false; code: 'missing-job-reference' | 'invalid-job-reference'; message: string; value?: string }

export function validateJobReference(value: string | null | undefined): JobReferenceValidation {
  const normalized = normalizeJobReference(value)
  if (!normalized) {
    return {
      ok: false,
      code: 'missing-job-reference',
      message: 'Job Reference is required before provisioning a tracker.',
    }
  }

  if (!JOB_REFERENCE_PATTERN.test(normalized)) {
    return {
      ok: false,
      code: 'invalid-job-reference',
      message: `Job Reference "${normalized}" is invalid. Expected format like ${JOB_REFERENCE_EXAMPLE}.`,
      value: normalized,
    }
  }

  if (normalized.length > 100) {
    return {
      ok: false,
      code: 'invalid-job-reference',
      message: `Job Reference "${normalized}" is too long. Maximum length is 100 characters.`,
      value: normalized,
    }
  }

  return { ok: true, value: normalized }
}
