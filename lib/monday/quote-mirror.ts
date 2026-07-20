/**
 * Quote-status mirror (portal) — §E, ported from the studio webhook
 * (`monday.js` mapMondayStatusToQuoteEnum + mirrorStatusToQuote).
 *
 * ⚠️ GATED OFF BY DEFAULT (`ENABLE_QUOTE_STATUS_MIRROR`). The portal's
 * `quotes.status` is free-text and currently uses `approved` / `awaiting-proof-
 * review`; it is rendered to customers by `components/leavers-admin/StatusBadge`
 * (which only styles pending/approved/rejected/completed/draft). The studio's
 * enum vocabulary here (`in_production`, `dispatched`, `quoted`, `accepted`, …)
 * would render as raw gray text and change customer-facing quote badges. So the
 * live writes stay INERT until the portal quote vocabulary is confirmed and the
 * flag is flipped. `quote_status_history` columns verified live 2026-07-20.
 *
 * Non-fatal: failures are logged, never thrown (fire-and-forget from the route).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export function mapMondayStatusToQuoteEnum(rawLabel: string | null | undefined): string | null {
  if (!rawLabel || typeof rawLabel !== 'string') return null
  const s = rawLabel.trim().toLowerCase()
  const map: Record<string, string> = {
    new: 'new',
    review: 'review',
    'under review': 'review',
    quoted: 'quoted',
    accepted: 'accepted',
    approved: 'accepted',
    'proof approved': 'in_production',
    'in production': 'in_production',
    production: 'in_production',
    'in progress': 'in_production',
    shipped: 'dispatched',
    dispatched: 'dispatched',
    'in transit': 'dispatched',
    delivered: 'completed',
    completed: 'completed',
    done: 'completed',
    rejected: 'rejected',
    cancelled: 'cancelled',
    canceled: 'cancelled',
  }
  return map[s] ?? null
}

export async function mirrorStatusToQuote(
  admin: SupabaseClient,
  {
    quoteId,
    rawMondayStatus,
    columnId,
    changedAt,
    userId,
  }: {
    quoteId: string
    rawMondayStatus: string
    columnId: string
    changedAt: string
    userId?: number | string | null
  }
): Promise<void> {
  // Portal-safety gate: no DB writes at all until explicitly enabled.
  if (process.env.ENABLE_QUOTE_STATUS_MIRROR !== 'true') return
  if (!quoteId) return

  const mapped = mapMondayStatusToQuoteEnum(rawMondayStatus)
  if (!mapped) return

  const { data: current, error: readError } = await admin
    .from('quotes')
    .select('id, status')
    .eq('id', quoteId)
    .maybeSingle()
  if (readError) {
    console.error('[quote-mirror] failed to read quote:', readError.message)
    return
  }
  if (!current) return
  if ((current as { status: string | null }).status === mapped) return

  const { error: updError } = await admin.from('quotes').update({ status: mapped }).eq('id', quoteId)
  if (updError) {
    console.error('[quote-mirror] update failed:', updError.message)
    return
  }

  const { error: histError } = await admin.from('quote_status_history').insert({
    quote_id: quoteId,
    from_status: (current as { status: string | null }).status,
    to_status: mapped,
    actor: 'monday-webhook',
    source: 'production-board',
    metadata: { columnId, mondayLabel: rawMondayStatus, userId: userId ?? null },
    changed_at: changedAt,
  })
  if (histError) {
    console.error('[quote-mirror] history insert failed:', histError.message)
  }
}
