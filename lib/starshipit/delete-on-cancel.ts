// lib/starshipit/delete-on-cancel.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { isStarshipitEnabled } from './config'
import { deleteStarshipitOrder } from './client'

/**
 * Best-effort removal of a cancelled order from the Starshipit print queue
 * (design D7/P3). No-op unless the order was actually pushed. NEVER throws —
 * cancellation must always succeed regardless of Starshipit. On API failure
 * the stamp is kept so the stale queue entry stays visible/attributable and
 * staff can delete it manually.
 */
export async function deleteStarshipitOrderOnCancel(
  admin: SupabaseClient,
  args: { orderId: string; organizationId: string },
): Promise<void> {
  try {
    if (!isStarshipitEnabled()) return

    const { data } = await admin
      .from('orders')
      .select('starshipit_pushed_at, starshipit_order_id')
      .eq('id', args.orderId)
      .maybeSingle()
    const row = data as {
      starshipit_pushed_at?: string | null
      starshipit_order_id?: string | null
    } | null
    if (!row?.starshipit_pushed_at || !row.starshipit_order_id) return

    const deleted = await deleteStarshipitOrder(row.starshipit_order_id)
    if (!deleted) {
      await recordAuditEvent(
        {
          orgId: args.organizationId,
          actorUserId: null,
          action: AUDIT_ACTIONS.ORDER_STARSHIPIT_DELETE_FAILED,
          targetType: 'order',
          targetId: args.orderId,
          metadata: { starshipit_order_id: row.starshipit_order_id },
        },
        admin,
      )
      return
    }

    await admin
      .from('orders')
      .update({ starshipit_pushed_at: null, starshipit_order_id: null })
      .eq('id', args.orderId)
    await recordAuditEvent(
      {
        orgId: args.organizationId,
        actorUserId: null,
        action: AUDIT_ACTIONS.ORDER_STARSHIPIT_DELETED,
        targetType: 'order',
        targetId: args.orderId,
        metadata: { starshipit_order_id: row.starshipit_order_id },
      },
      admin,
    )
  } catch (e) {
    console.error('[starshipit] delete-on-cancel failed', {
      orderId: args.orderId,
      err: e instanceof Error ? e.message : String(e),
    })
  }
}
