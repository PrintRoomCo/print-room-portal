/**
 * Monday webhook audit logging (portal).
 *
 * Ported from the studio webhook handler (`monday.js` logWebhookEvent /
 * markWebhookLog) so the portal records every production-board event it handles
 * and its outcome. Shared table `job_tracker_webhook_logs` — columns verified
 * live 2026-07-20: monday_item_id, board_id, column_id, event_type,
 * payload(jsonb), status, error, processed_at, notes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type WebhookLogStatus = 'processed' | 'noop' | 'missing-job' | 'failed'

function sanitizeJson(value: unknown): unknown {
  if (value === null || typeof value === 'undefined') return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

export async function logWebhookEvent(
  admin: SupabaseClient,
  {
    mondayItemId,
    boardId,
    columnId,
    eventType,
    payload,
  }: {
    mondayItemId: string
    boardId: number | string | null
    columnId: string | null
    eventType: string | null
    payload: unknown
  }
): Promise<string | null> {
  const { data, error } = await admin
    .from('job_tracker_webhook_logs')
    .insert({
      monday_item_id: mondayItemId,
      board_id: boardId != null ? String(boardId) : null,
      column_id: columnId,
      event_type: eventType,
      payload: sanitizeJson(payload),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[tracker] Failed to log Monday webhook event', error)
    return null
  }
  return (data as { id?: string } | null)?.id ?? null
}

export async function markWebhookLog(
  admin: SupabaseClient,
  logId: string | null,
  updates: { status?: WebhookLogStatus; error?: string | null; notes?: string | null; processed_at?: string }
): Promise<void> {
  if (!logId) return
  const payload = sanitizeJson({
    processed_at: new Date().toISOString(),
    ...updates,
  }) as Record<string, unknown> | null
  if (!payload) return

  const { error } = await admin.from('job_tracker_webhook_logs').update(payload).eq('id', logId)
  if (error) {
    console.error('[tracker] Failed to update webhook log', error)
  }
}
