import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve which b2b_catalogue_items.id values a member can see.
 *
 * Rules (mirror of `auth_member_has_catalogue_item` RLS helper):
 *   1. Member must have a catalogue grant for the item's catalogue.
 *   2. Within a granted catalogue, item visibility is:
 *      - "all items" when zero item-grants exist for (member, catalogue) → every active item.
 *      - "whitelist" when one or more item-grants exist → only the explicit set.
 *
 * Returned set is the union across all granted catalogues.
 */
export async function getGrantedCatalogueItemIds(
  admin: SupabaseClient,
  membershipId: string,
  organizationId: string,
): Promise<string[]> {
  // 1. Catalogues granted to this membership (intersected with org's active catalogues).
  const { data: grantedRows } = await admin
    .from('b2b_member_catalogue_grants')
    .select('catalogue_id, b2b_catalogues!inner(id, organization_id, is_active)')
    .eq('membership_id', membershipId)
    .eq('b2b_catalogues.organization_id', organizationId)
    .eq('b2b_catalogues.is_active', true)

  const grantedCatalogueIds = ((grantedRows ?? []) as Array<{ catalogue_id: string }>)
    .map((r) => r.catalogue_id)

  if (grantedCatalogueIds.length === 0) return []

  // 2. Active items in those catalogues, plus item grants for this membership.
  const [{ data: items }, { data: itemGrants }] = await Promise.all([
    admin
      .from('b2b_catalogue_items')
      .select('id, catalogue_id')
      .in('catalogue_id', grantedCatalogueIds)
      .eq('is_active', true),
    admin
      .from('b2b_member_catalogue_item_grants')
      .select('catalogue_item_id')
      .eq('membership_id', membershipId),
  ])

  type ItemRow = { id: string; catalogue_id: string }
  const itemRows = (items ?? []) as ItemRow[]
  const itemGrantSet = new Set(
    ((itemGrants ?? []) as Array<{ catalogue_item_id: string }>).map((r) => r.catalogue_item_id),
  )

  // 3. Determine per-catalogue mode: any item-grant inside a catalogue → whitelist mode.
  const itemsByCatalogue = new Map<string, string[]>()
  const catalogueHasItemGrant = new Set<string>()
  for (const row of itemRows) {
    const arr = itemsByCatalogue.get(row.catalogue_id) ?? []
    arr.push(row.id)
    itemsByCatalogue.set(row.catalogue_id, arr)
    if (itemGrantSet.has(row.id)) catalogueHasItemGrant.add(row.catalogue_id)
  }

  // 4. Compose the allowlist.
  const allow = new Set<string>()
  for (const [catalogueId, ids] of itemsByCatalogue) {
    if (catalogueHasItemGrant.has(catalogueId)) {
      // whitelist mode — only explicitly granted items
      for (const id of ids) if (itemGrantSet.has(id)) allow.add(id)
    } else {
      // all-items mode — every active item in the granted catalogue
      for (const id of ids) allow.add(id)
    }
  }

  return Array.from(allow)
}
