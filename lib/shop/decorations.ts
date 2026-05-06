import type { SupabaseClient } from '@supabase/supabase-js'

export interface DecorationOption {
  /** b2b_catalogue_item_decorations.id */
  linkId: string
  /** org_decorations.id */
  decorationId: string
  /** display name, e.g. "Embroidery — Left Chest" */
  name: string
  /** screenprint | embroidery | heatpress | supacolour | dtf */
  method: string
  /** human-readable position, e.g. "Left chest". Null when no location set. */
  positionLabel: string | null
  /** resolved server-side: COALESCE(link.unit_price_override, decoration.unit_price) */
  unitPrice: number
  /** raw artwork thumbnail (always present). */
  artworkUrl: string
  artworkName: string
  /** designer-rendered mockup, populated by Phase 8. Null in Phase 5. */
  snapshotUrl: string | null
  snapshotColorSwatchId: string | null
  isDefault: boolean
  sortOrder: number
}

interface RawLinkRow {
  id: string
  is_default: boolean | null
  sort_order: number | null
  unit_price_override: number | string | null
  snapshot_url: string | null
  snapshot_color_swatch_id: string | null
  decoration:
    | RawDecoration
    | RawDecoration[]
    | null
}

interface RawDecoration {
  id: string
  organization_id: string
  name: string
  decoration_method: string
  unit_price: number | string
  is_active: boolean
  artwork:
    | { id: string; name: string; public_url: string }
    | { id: string; name: string; public_url: string }[]
    | null
  location:
    | { id: string; location: string; placement_key: string | null }
    | { id: string; location: string; placement_key: string | null }[]
    | null
}

const LINK_SELECT = `
  id,
  is_default,
  sort_order,
  unit_price_override,
  snapshot_url,
  snapshot_color_swatch_id,
  decoration:org_decorations!b2b_catalogue_item_decorations_org_decoration_id_fkey(
    id,
    organization_id,
    name,
    decoration_method,
    unit_price,
    is_active,
    artwork:organization_artworks!org_decorations_artwork_id_fkey(
      id,
      name,
      public_url
    ),
    location:decoration_locations!org_decorations_decoration_location_id_fkey(
      id,
      location,
      placement_key
    )
  )
`

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export async function loadCatalogueItemDecorations(
  admin: SupabaseClient,
  catalogueItemId: string,
): Promise<DecorationOption[]> {
  const { data, error } = await admin
    .from('b2b_catalogue_item_decorations')
    .select(LINK_SELECT)
    .eq('catalogue_item_id', catalogueItemId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[loadCatalogueItemDecorations]', error)
    return []
  }

  const rows = (data ?? []) as unknown as RawLinkRow[]
  const out: DecorationOption[] = []
  for (const row of rows) {
    const dec = pickOne(row.decoration)
    if (!dec || !dec.is_active) continue
    const art = pickOne(dec.artwork)
    if (!art) continue
    const loc = pickOne(dec.location)
    const baseUnitPrice = Number(dec.unit_price)
    const overridePrice =
      row.unit_price_override != null ? Number(row.unit_price_override) : null
    const unitPrice = Number.isFinite(overridePrice as number)
      ? (overridePrice as number)
      : baseUnitPrice
    out.push({
      linkId: row.id,
      decorationId: dec.id,
      name: dec.name,
      method: dec.decoration_method,
      positionLabel: loc?.location ?? null,
      unitPrice,
      artworkUrl: art.public_url,
      artworkName: art.name,
      snapshotUrl: row.snapshot_url,
      snapshotColorSwatchId: row.snapshot_color_swatch_id,
      isDefault: row.is_default === true,
      sortOrder: row.sort_order ?? 0,
    })
  }
  return out
}
