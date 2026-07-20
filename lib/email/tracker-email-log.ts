/**
 * Durable per-transition tracker-email de-dup (portal).
 *
 * Ported from `print-room-studio/apps/job-tracker/lib/email-dedup.js`, but the
 * Supabase (service-role) client is injected rather than a module singleton so
 * the webhook route can pass its own admin client.
 *
 * De-dup semantics = per-transition idempotent (spec §C, decision 2): the email
 * type encodes the canonical stage AND the Monday event's trigger-time epoch,
 * which is stable across Monday's at-least-once re-delivery of the SAME event
 * (so a retry does not re-email) but changes on a genuine re-entry to a stage
 * (e.g. proof-sent → need-proof → proof-sent after a revision — which re-emails).
 *
 * Shared table `tracker_email_log` — columns verified live 2026-07-20.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Build the de-dup key for a status-update email. `status_update:<key>:<epochMs>`.
 * `epochMs` is 0 when the trigger time is missing/unparseable — the (rare)
 * fallback still de-dups within a single delivery via the handler's fast-path.
 */
export function statusEmailType(canonicalKey: string, triggerTime: string | null | undefined): string {
  const epoch = triggerTime ? Date.parse(triggerTime) : NaN
  return `status_update:${canonicalKey}:${Number.isNaN(epoch) ? 0 : epoch}`
}

export async function hasEmailBeenSent(
  admin: SupabaseClient,
  { mondayItemId, emailType }: { mondayItemId: string; emailType: string }
): Promise<boolean> {
  if (!mondayItemId || !emailType) return false
  const { data } = await admin
    .from('tracker_email_log')
    .select('id')
    .eq('monday_item_id', mondayItemId)
    .eq('email_type', emailType)
    .eq('email_sent', true)
    .maybeSingle()
  return !!data
}

export async function recordEmailSend(
  admin: SupabaseClient,
  {
    mondayItemId,
    trackerToken,
    customerEmail,
    emailType,
    emailSent,
    emailId,
    errorMessage,
    triggerType = 'automatic',
    triggeredByUserId,
  }: {
    mondayItemId: string
    trackerToken?: string | null
    customerEmail: string | null
    emailType: string
    emailSent: boolean
    emailId?: string | null
    errorMessage?: string | null
    triggerType?: 'automatic' | 'manual'
    triggeredByUserId?: string | null
  }
): Promise<void> {
  const { error } = await admin.from('tracker_email_log').insert({
    monday_item_id: mondayItemId,
    tracker_token: trackerToken || '',
    customer_email: customerEmail,
    email_type: emailType,
    email_sent: emailSent,
    email_id: emailId || null,
    error_message: errorMessage || null,
    trigger_type: triggerType,
    triggered_by_user_id: triggeredByUserId || null,
    sent_at: new Date().toISOString(),
  })
  if (error) {
    console.error(`[tracker-email-log] Failed to log ${emailType}:`, error)
  }
}
