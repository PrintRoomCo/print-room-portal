import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImageLayout } from './image-layout'

/**
 * A member-visible catalogue item, with the columns the catalogue grid needs.
 * `catalogue_id` is carried through only for the internal whitelist logic; it is
 * not part of the grid's contract.
 */
export interface GrantedCatalogueItemRow {
  id: string
  catalogue_id: string
  source_product_id: string
  fulfilment_type_override: string | null
  card_image_id: string | null
  price_mode: 'computed' | 'manual_final' | null
  image_layout_override: ImageLayout | null
}

// The column list the grid consumes. Selected in BOTH resolution paths so a
// caller with the full rows never has to re-query b2b_catalogue_items just to
// pick up these fields (that second round-trip was the catalogue page's hot
// path — see getGrantedCatalogueItems callers).
const GRID_ITEM_COLUMNS =
  'id, catalogue_id, source_product_id, fulfilment_type_override, card_image_id, price_mode, image_layout_override'

/**
 * Resolve the full b2b_catalogue_items rows a member can see (not just ids).
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
export async function getGrantedCatalogueItems(
  admin: SupabaseClient,
  membershipId: string,
  organizationId: string,
): Promise<GrantedCatalogueItemRow[]> {
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
      .select(`${GRID_ITEM_COLUMNS}, b2b_catalogues!inner(organization_id, is_active)`)
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', organizationId)
      .eq('b2b_catalogues.is_active', true)

    return ((adminItems ?? []) as unknown as GrantedCatalogueItemRow[]).map(normaliseRow)
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
      .select(GRID_ITEM_COLUMNS)
      .in('catalogue_id', visibleCatalogueIds)
      .eq('is_active', true),
    admin
      .from('b2b_member_catalogue_item_grants')
      .select('catalogue_item_id')
      .eq('membership_id', membershipId),
  ])

  const itemRows = ((items ?? []) as unknown as GrantedCatalogueItemRow[]).map(normaliseRow)
  const itemGrantSet = new Set(
    ((itemGrants ?? []) as Array<{ catalogue_item_id: string }>).map((r) => r.catalogue_item_id),
  )

  // 3. Determine per-catalogue mode: any item-grant inside a catalogue → whitelist mode.
  const rowsByCatalogue = new Map<string, GrantedCatalogueItemRow[]>()
  const catalogueHasItemGrant = new Set<string>()
  for (const row of itemRows) {
    const arr = rowsByCatalogue.get(row.catalogue_id) ?? []
    arr.push(row)
    rowsByCatalogue.set(row.catalogue_id, arr)
    if (itemGrantSet.has(row.id)) catalogueHasItemGrant.add(row.catalogue_id)
  }

  // 4. Compose the allowlist (dedup by id across catalogues, order preserved).
  const allow: GrantedCatalogueItemRow[] = []
  const seen = new Set<string>()
  const push = (row: GrantedCatalogueItemRow) => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    allow.push(row)
  }
  for (const [catalogueId, catRows] of rowsByCatalogue) {
    if (catalogueHasItemGrant.has(catalogueId)) {
      // whitelist mode — only explicitly granted items
      for (const row of catRows) if (itemGrantSet.has(row.id)) push(row)
    } else {
      // all-items mode — every active item in the granted catalogue
      for (const row of catRows) push(row)
    }
  }

  return allow
}

// The stub in member-access.test.ts (and any legacy caller) may hand back rows
// carrying only `id`. Fill the grid columns with nulls so downstream Maps never
// see `undefined` where they expect a nullable field.
function normaliseRow(row: Partial<GrantedCatalogueItemRow> & { id: string }): GrantedCatalogueItemRow {
  return {
    id: row.id,
    catalogue_id: row.catalogue_id ?? '',
    source_product_id: row.source_product_id ?? '',
    fulfilment_type_override: row.fulfilment_type_override ?? null,
    card_image_id: row.card_image_id ?? null,
    price_mode: row.price_mode ?? null,
    image_layout_override: row.image_layout_override ?? null,
  }
}

/**
 * Resolve which b2b_catalogue_items.id values a member can see. Thin wrapper
 * over {@link getGrantedCatalogueItems} — kept as the stable id-only contract
 * used by availability/review-images/checkout/resolve-catalogue-item.
 */
export async function getGrantedCatalogueItemIds(
  admin: SupabaseClient,
  membershipId: string,
  organizationId: string,
): Promise<string[]> {
  const rows = await getGrantedCatalogueItems(admin, membershipId, organizationId)
  return rows.map((r) => r.id)
}
