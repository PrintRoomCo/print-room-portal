// lib/starshipit/push-on-production-complete.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { isStarshipitEnabled } from './config'
import { isReadyToDispatchLabel } from './ready-to-dispatch'
import { pushOrderToStarshipit } from './push-order'

export interface ProductionCompletePushArgs {
  /** job_trackers.quote_id from the Monday tracker-status webhook. */
  quoteId: string
  /** Raw Monday status label (event.value.label.text). */
  displayLabel: string
}

/**
 * Made-to-order Starshipit bridge (design D4): when Monday production reaches
 * "All Production Complete", register the order so staff can print the courier
 * ticket. Self-filtering (flag + label checked here) and best-effort: safe to
 * call on EVERY accepted status change, and NEVER throws — the Monday webhook
 * must always return 200. Idempotency lives in pushOrderToStarshipit (D6), so
 * Monday's at-least-once redelivery and label flip-flops cannot double-push.
 */
export async function pushOrderOnProductionComplete(
  admin: SupabaseClient,
  args: ProductionCompletePushArgs,
): Promise<void> {
  try {
    if (!isStarshipitEnabled()) return
    if (!isReadyToDispatchLabel(args.displayLabel)) return

    // Latest order for the quote. Monday also tracks quote-form jobs that have
    // no orders row — those are silently not ours.
    const { data: orderData } = await admin
      .from('orders')
      .select('id, status, intent, order_type, shipping_address')
      .eq('quote_id', args.quoteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const order = orderData as {
      id: string
      status: string
      intent: string | null
      order_type: string | null
      shipping_address: Record<string, unknown> | null
    } | null
    if (!order) return
    if (order.status === 'cancelled') return

    const { data: quoteData } = await admin
      .from('quotes')
      .select('order_ref, customer_email, organization_id, shipping_address')
      .eq('id', args.quoteId)
      .maybeSingle()
    const quote = quoteData as {
      order_ref: string | null
      customer_email: string | null
      organization_id: string | null
      shipping_address: Record<string, unknown> | null
    } | null
    if (!quote?.order_ref || !quote.organization_id) return

    const { data: orgData } = await admin
      .from('organizations')
      .select('is_test')
      .eq('id', quote.organization_id)
      .maybeSingle()

    try {
      const result = await pushOrderToStarshipit(admin, {
        orderId: order.id,
        orderRef: quote.order_ref,
        quoteId: args.quoteId,
        organizationId: quote.organization_id,
        actorUserId: null,
        trigger: 'production_complete',
        intent: order.intent === 'inventory' ? 'inventory' : 'customer',
        isTestOrg: Boolean((orgData as { is_test?: boolean } | null)?.is_test),
        isStockOnHand: order.order_type === 'stock_on_hand',
        customerEmail: quote.customer_email ?? null,
        shippingAddress: order.shipping_address ?? quote.shipping_address ?? null,
      })
      if (result.status === 'skipped') {
        await recordAuditEvent(
          {
            orgId: quote.organization_id,
            actorUserId: null,
            action: AUDIT_ACTIONS.ORDER_STARSHIPIT_SKIPPED,
            targetType: 'order',
            targetId: order.id,
            metadata: {
              order_ref: quote.order_ref,
              reason: result.reason,
              trigger: 'production_complete',
            },
          },
          admin,
        )
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[starshipit] production-complete push failed', {
        quoteId: args.quoteId,
        err: message,
      })
      await recordAuditEvent(
        {
          orgId: quote.organization_id,
          actorUserId: null,
          action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSH_FAILED,
          targetType: 'order',
          targetId: order.id,
          metadata: {
            order_ref: quote.order_ref,
            quote_id: args.quoteId,
            error: message,
            trigger: 'production_complete',
          },
        },
        admin,
      )
    }
  } catch (e) {
    // Outer belt-and-braces: never let the bridge disturb the webhook.
    console.error('[starshipit] production-complete bridge error', e)
  }
}
