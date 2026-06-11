// lib/pricing/period-brackets.ts
//
// Pre-order pricing reads the PERIOD SNAPSHOT, not the live ladder
// (spec §3.5 / decision 9): the snapshot taken at period-open is the menu
// for the whole window, so PDP brackets, the cart's qty re-picks, and the
// checkout's canonical re-price all agree byte-for-byte. Snapshot prices
// are customer-final (tier multiplier already applied at snapshot time).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CartLineBracket } from '@/lib/cart/types'

export interface OpenPeriod {
  id: string
  closesAt: string
}

export async function getOpenPeriodForOrg(
  admin: SupabaseClient,
  organizationId: string,
): Promise<OpenPeriod | null> {
  const { data } = await admin
    .from('b2b_ordering_periods')
    .select('id, closes_at')
    .eq('organization_id', organizationId)
    .eq('status', 'open')
    .gt('closes_at', new Date().toISOString())
    .maybeSingle()
  if (!data) return null
  return { id: data.id as string, closesAt: data.closes_at as string }
}

/** Effective fulfilment for catalogue items: override ?? product default. */
export async function getPreOrderItemIds(
  admin: SupabaseClient,
  catalogueItemIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (catalogueItemIds.length === 0) return out
  const { data } = await admin
    .from('b2b_catalogue_items')
    .select('id, fulfilment_type_override, products:source_product_id ( fulfilment_type )')
    .in('id', catalogueItemIds)
  for (const row of (data ?? []) as Array<{
    id: string
    fulfilment_type_override: string | null
    products:
      | { fulfilment_type: string | null }
      | Array<{ fulfilment_type: string | null }>
      | null
  }>) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products
    const effective = row.fulfilment_type_override ?? product?.fulfilment_type ?? null
    if (effective === 'pre_order') out.add(row.id)
  }
  return out
}

/** Snapshot bands as cart brackets (garment-only, customer-final). */
export async function getPeriodBracketsForItem(
  admin: SupabaseClient,
  periodId: string,
  catalogueItemId: string,
): Promise<CartLineBracket[]> {
  const { data } = await admin
    .from('b2b_ordering_period_item_pricing')
    .select('min_quantity, max_quantity, final_unit_price')
    .eq('period_id', periodId)
    .eq('catalogue_item_id', catalogueItemId)
    .order('min_quantity', { ascending: true })
  return ((data ?? []) as Array<{
    min_quantity: number
    max_quantity: number | null
    final_unit_price: number
  }>).map((b) => ({
    minQty: b.min_quantity,
    maxQty: b.max_quantity,
    unitPrice: Number(b.final_unit_price),
  }))
}
