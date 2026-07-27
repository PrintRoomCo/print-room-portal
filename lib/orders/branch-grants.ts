import type { SupabaseClient } from '@supabase/supabase-js'

export function resolveBranchStoreIds(grantStoreIds: string[], defaultStoreId: string | null): string[] {
  const set = new Set(grantStoreIds.filter((s): s is string => Boolean(s)))
  if (defaultStoreId) set.add(defaultStoreId)
  return [...set]
}

export function buildStoreGrantDiff(existing: string[], desired: string[]): { toInsert: string[]; toDelete: string[] } {
  const have = new Set(existing)
  const want = new Set(desired)
  return { toInsert: [...want].filter((id) => !have.has(id)), toDelete: [...have].filter((id) => !want.has(id)) }
}

/**
 * VIEW-side branch set. Returns [] when the member has NO grants, so plain staff
 * keep today's own-orders-only view (we do NOT union the default for non-managers).
 * A member with ≥1 grant is a manager: grants ∪ default.
 *
 * NB the asymmetry with checkout: checkout calls resolveBranchStoreIds(grants, default)
 * UNCONDITIONALLY (plain staff => [default], today's single-branch lock); the view
 * side gates on grants>0 here. This is the backward-compat contract.
 */
export async function getMemberBranchStoreIds(
  admin: SupabaseClient,
  membershipId: string,
  defaultStoreId: string | null,
): Promise<string[]> {
  const { data } = await admin.from('b2b_member_store_grants').select('store_id').eq('membership_id', membershipId)
  const grants = (data ?? []).map((g) => (g as { store_id: string }).store_id)
  return grants.length ? resolveBranchStoreIds(grants, defaultStoreId) : []
}
