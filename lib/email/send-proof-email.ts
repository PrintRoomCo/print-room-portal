import { getSupabaseServer } from '@/lib/supabase'

/**
 * Slice D — customer-portal twin of the staff `sendProofEmail` helper.
 *
 * Thin transport wrapper over the `send-proof-email` Edge Function deployed
 * in Slice B. The edge function handles Resend, audit logging, and env-var
 * validation. This helper does NOT validate the payload, log inputs, or
 * touch the Resend API key.
 *
 * Contract is identical to the staff portal helper at
 * `print-room-staff-portal/src/lib/email/send-proof-email.ts`. The two
 * implementations are kept separate (no cross-repo imports possible); any
 * behavioural drift is a bug.
 *
 * Contract: NEVER throws. Every failure mode collapses to `{ ok: false, error }`.
 */

export type ProofEmailKind =
  | 'proof.customer_ready'
  | 'proof.am_autofill'
  | 'proof.am_amendment_request'

export type ProofEmailCorrelation = {
  proof_id?: string
  order_id?: string
  amendment_request_id?: string
}

export type SendProofEmailInput = {
  to: string
  subject: string
  html: string
  text?: string
  kind: ProofEmailKind
  correlation?: ProofEmailCorrelation
}

export type SendProofEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string }

function extractErrorMessage(value: unknown, fallback: string): string {
  if (value == null) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const obj = value as { message?: unknown; error?: unknown }
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message
    if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error
  }
  return fallback
}

export async function sendProofEmail(
  input: SendProofEmailInput,
): Promise<SendProofEmailResult> {
  try {
    const admin = getSupabaseServer()
    const { data, error } = await admin.functions.invoke('send-proof-email', {
      body: input,
    })

    // Transport-level / non-2xx failure: supabase-js puts the error on `error`
    // and `data` is null. This covers misconfig (5xx from edge fn) and any
    // FunctionsHttpError/FunctionsFetchError/FunctionsRelayError.
    if (error) {
      return { ok: false, error: extractErrorMessage(error, 'edge function error') }
    }

    // 2xx but body unparseable / empty.
    if (data == null || typeof data !== 'object') {
      return { ok: false, error: 'unexpected response shape' }
    }

    const body = data as {
      ok?: unknown
      messageId?: unknown
      error?: unknown
    }

    // Edge fn passthrough: 200 + { ok: false, error } (Resend best-effort fail).
    if (body.ok === false) {
      return {
        ok: false,
        error: extractErrorMessage(body.error, 'send failed'),
      }
    }

    // Happy path: 200 + { ok: true, messageId }.
    if (body.ok === true && typeof body.messageId === 'string') {
      return { ok: true, messageId: body.messageId }
    }

    // Anything else is an unexpected shape — never throw, just report.
    return { ok: false, error: 'unexpected response shape' }
  } catch (err) {
    return {
      ok: false,
      error: extractErrorMessage(err, 'unknown error'),
    }
  }
}
