import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve which b2b_catalogue_items.id values a member can see.
 *
 * Rules (mirror of `auth_member_has_catalogue_item` RLS helper):
 *   0. `org_admin` membership role implicitly grants access to every active
 *      item in every active catalogue in the org.
 *   1. Otherwise, resolve the member's VISIBLE catalogues:
 *      - zero catalogue-grants  → every active catalogue in the org (default).
 *      - one+ catalogue-grants  → only those granted catalogues (whitelist).
 *   2. Within each visible catalogue, item visibility is:
 *      - "all items" when zero item-grants exist for (member, catalogue).
 *      - "whitelist" when one or more item-grants exist → only the explicit set.
 *
 * Returned set is the union across all granted catalogues.
 */
export async function getGrantedCatalogueItemIds(
  admin: SupabaseClient,
  membershipId: string,
  organizationId: string,
): Promise<string[]> {
  // 0. Admin bypass — admins see every active item in every active catalogue
  // in their org, regardless of b2b_member_catalogue_grants rows.
  const { data: membership } = await admin
    .from('user_organizations')
    .select('role')
    .eq('id', membershipId)
    .maybeSingle()

  if ((membership as { role?: string } | null)?.role === 'org_admin') {
    const { data: adminItems } = await admin
      .from('b2b_catalogue_items')
      .select('id, b2b_catalogues!inner(organization_id, is_active)')
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', organizationId)
      .eq('b2b_catalogues.is_active', true)

    return ((adminItems ?? []) as Array<{ id: string }>).map((r) => r.id)
  }

  // 1. Catalogues explicitly granted to this membership (∩ org's active catalogues).
  const { data: grantedRows } = await admin
    .from('b2b_member_catalogue_grants')
    .select('catalogue_id, b2b_catalogues!inner(id, organization_id, is_active)')
    .eq('membership_id', membershipId)
    .eq('b2b_catalogues.organization_id', organizationId)
    .eq('b2b_catalogues.is_active', true)

  const grantedCatalogueIds = ((grantedRows ?? []) as Array<{ catalogue_id: string }>)
    .map((r) => r.catalogue_id)

  // 2. Resolve VISIBLE catalogues. Auto-grant default: a member with zero
  //    catalogue grants sees every active catalogue in their org; one+ grant
  //    flips that catalogue set to a strict whitelist.
  let visibleCatalogueIds: string[]
  if (grantedCatalogueIds.length === 0) {
    const { data: activeCats } = await admin
      .from('b2b_catalogues')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
    visibleCatalogueIds = ((activeCats ?? []) as Array<{ id: string }>).map((r) => r.id)
  } else {
    visibleCatalogueIds = grantedCatalogueIds
  }

  if (visibleCatalogueIds.length === 0) return []

  const [{ data: items }, { data: itemGrants }] = await Promise.all([
    admin
      .from('b2b_catalogue_items')
      .select('id, catalogue_id')
      .in('catalogue_id', visibleCatalogueIds)
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
