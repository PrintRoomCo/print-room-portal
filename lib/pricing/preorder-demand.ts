import type { SupabaseClient } from '@supabase/supabase-js'

/** Aggregate pre-order demand for one catalogue item in the current open
 *  ordering period — product level (summed across all colours/sizes). */
export interface PreOrderDemand {
  /** Total units ordered across the franchise network this period. */
  unitsOrdered: number
  /** Distinct non-cancelled orders containing the item this period. */
  orderCount: number
}

type PeriodProgressRow = {
  catalogue_item_id: string
  agg_qty: number | null
  order_count: number | null
}

/**
 * Reads period_progress_for_org (open-period, whole-network aggregate) and
 * returns the row for one catalogue item. Fail-soft: RPC error, no open period,
 * or no matching row → null. This is social proof — it must never break the PDP.
 */
export async function getPreOrderDemandForItem(
  admin: SupabaseClient,
  orgId: string,
  catalogueItemId: string,
): Promise<PreOrderDemand | null> {
  const { data, error } = await admin.rpc('period_progress_for_org', {
    p_org_id: orgId,
  })
  if (error || !data) return null
  const row = (data as PeriodProgressRow[]).find(
    (r) => r.catalogue_item_id === catalogueItemId,
  )
  if (!row) return null
  return { unitsOrdered: row.agg_qty ?? 0, orderCount: row.order_count ?? 0 }
}
