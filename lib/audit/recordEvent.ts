import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase'

const METADATA_LIMIT_BYTES = 4096

export type RecordAuditEventArgs = {
  orgId: string | null
  actorUserId: string | null
  action: string
  targetType?: string
  targetId?: string | null
  metadata?: Record<string, unknown>
}

export async function recordAuditEvent(
  args: RecordAuditEventArgs,
  client?: SupabaseClient,
): Promise<void> {
  const admin = client ?? getSupabaseServer()

  let metadata: Record<string, unknown> = args.metadata ?? {}
  const serialised = JSON.stringify(metadata)
  if (serialised.length > METADATA_LIMIT_BYTES) {
    metadata = { _truncated: true, head: serialised.slice(0, 3900) }
  }

  const { error } = await admin.from('audit_events').insert({
    org_id: args.orgId,
    actor_user_id: args.actorUserId,
    action: args.action,
    target_type: args.targetType ?? null,
    target_id: args.targetId ?? null,
    metadata,
  })

  if (error) {
    console.error('audit_event_write_failed', { action: args.action, error })
  }
}
