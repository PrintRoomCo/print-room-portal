import { getSupabaseServer } from '@/lib/supabase'

/**
 * Resolve a Monday subitem to its quote_items rows and call ship_quote_line for
 * each one. Product subitems can represent multiple size rows.
 *
 * Matching strategy:
 *   1. Primary: quote_items.monday_subitem_id = subitemId.
 *   2. Fallback: quote_items.product_name ILIKE %subitemName% (temporary
 *      until the Replit push reliably writes monday_subitem_id).
 *
 * Non-matches are logged to job_tracker_webhook_logs with status
 * 'orphan_ship_event' for later reconciliation.
 */
export async function shipMondaySubitem(
  supabase: ReturnType<typeof getSupabaseServer>,
  subitemId: string,
  subitemName: string | null,
  payload: unknown
): Promise<{ ok: true; matched: 'subitem_id' | 'name' } | { ok: false; reason: 'orphan' }> {
  // Primary match: monday_subitem_id.
  const { data: bySubitem } = await supabase
    .from('quote_items')
    .select('id')
    .eq('monday_subitem_id', subitemId)

  let quoteItemIds = (bySubitem ?? []).map((row) => row.id)
  let matched: 'subitem_id' | 'name' | null =
    quoteItemIds.length > 0 ? 'subitem_id' : null

  // Name-match fallback (temporary until Replit push writes monday_subitem_id).
  if (quoteItemIds.length === 0 && subitemName) {
    const { data: byName } = await supabase
      .from('quote_items')
      .select('id')
      .ilike('product_name', `%${subitemName}%`)
      .limit(1)
      .maybeSingle()
    if (byName) {
      quoteItemIds = [byName.id]
      matched = 'name'
    }
  }

  if (quoteItemIds.length === 0) {
    await supabase.from('job_tracker_webhook_logs').insert({
      monday_item_id: subitemId,
      status: 'orphan_ship_event',
      payload: payload as never,
      notes: `Could not resolve subitem "${subitemName ?? ''}"`,
    })
    return { ok: false, reason: 'orphan' }
  }

  for (const quoteItemId of quoteItemIds) {
    const { error } = await supabase.rpc('ship_quote_line', {
      p_quote_item_id: quoteItemId,
    })
    if (error) {
      await supabase.from('job_tracker_webhook_logs').insert({
        monday_item_id: subitemId,
        status: 'ship_rpc_error',
        payload: payload as never,
        error: error.message,
      })
      return { ok: false, reason: 'orphan' }
    }
  }

  return { ok: true, matched: matched! }
}
