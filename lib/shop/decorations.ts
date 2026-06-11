import type { SupabaseClient } from '@supabase/supabase-js'

const ARTWORK_BUCKET = 'org-artworks'

export interface DecorationOverlay {
  // product_images.id this rect is anchored to — PDP gallery filters
  // overlays where imageId === currently-displayed-image.id
  imageId: string
  rect: { x: number; y: number; w: number; h: number }
  placement: { x: number; y: number; w: number; h: number; rotation_deg: number }
  artworkUrl: string
}

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
  /** raw artwork thumbnail. Null for details-only included decorations. */
  artworkUrl: string | null
  artworkName: string | null
  /** designer-rendered mockup, populated by Phase 8. Null in Phase 5. */
  snapshotUrl: string | null
  snapshotColorSwatchId: string | null
  isDefault: boolean
  sortOrder: number
  /**
   * Inputs needed to recompute the unit price at customer qty for screen-print.
   * Only populated when method = 'screenprint' AND all required inputs are present.
   * Null for embroidery and any decoration created before the autofill flow.
   */
  recalcInputs: {
    method: 'screenprint'
    widthMm: number
    heightMm: number
    colourCount: number
    placementKey: string
  } | null
  /**
   * Live PDP overlay payload — null when staff hasn't assigned a print area
   * or any required placement coord is missing.
   */
  overlay: DecorationOverlay | null
}

interface RawLinkRow {
  id: string
  is_default: boolean | null
  sort_order: number | null
  unit_price_override: number | string | null
  snapshot_url: string | null
  snapshot_color_swatch_id: string | null
  print_area_id: string | null
  placement_x: number | string | null
  placement_y: number | string | null
  placement_w: number | string | null
  placement_h: number | string | null
  placement_rotation_deg: number | string | null
  decoration:
    | RawDecoration
    | RawDecoration[]
    | null
  print_area:
    | RawPrintArea
    | RawPrintArea[]
    | null
}

interface RawPrintArea {
  id: string
  image_id: string
  rect_x: number | string | null
  rect_y: number | string | null
  rect_w: number | string | null
  rect_h: number | string | null
}

interface RawArtworkVariant {
  variant_type: string
  status: string
  storage_path: string | null
}

interface RawDecoration {
  id: string
  organization_id: string
  name: string
  decoration_method: string
  unit_price: number | string
  is_active: boolean
  width_mm: number | null
  height_mm: number | null
  colour_count: number | null
  artwork:
    | RawArtwork
    | RawArtwork[]
    | null
  location:
    | { id: string; location: string; placement_key: string | null }
    | { id: string; location: string; placement_key: string | null }[]
    | null
}

interface RawArtwork {
  id: string
  name: string
  public_url: string
  variants: RawArtworkVariant[] | null
}

const LINK_SELECT = `
  id,
  is_default,
  sort_order,
  unit_price_override,
  snapshot_url,
  snapshot_color_swatch_id,
  print_area_id,
  placement_x,
  placement_y,
  placement_w,
  placement_h,
  placement_rotation_deg,
  decoration:org_decorations!b2b_catalogue_item_decorations_org_decoration_id_fkey(
    id,
    organization_id,
    name,
    decoration_method,
    unit_price,
    is_active,
    width_mm,
    height_mm,
    colour_count,
    artwork:organization_artworks!org_decorations_artwork_id_fkey(
      id,
      name,
      public_url,
      variants:organization_artwork_variants!organization_artwork_variants_artwork_id_fkey(
        variant_type,
        status,
        storage_path
      )
    ),
    location:decoration_locations!org_decorations_decoration_location_id_fkey(
      id,
      location,
      placement_key
    )
  ),
  print_area:product_print_areas!b2b_catalogue_item_decorations_print_area_id_fkey(
    id,
    image_id,
    rect_x,
    rect_y,
    rect_w,
    rect_h
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
    .eq('is_published', true)
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
    const loc = pickOne(dec.location)
    const printArea = pickOne(row.print_area)
    const baseUnitPrice = Number(dec.unit_price)
    const overridePrice =
      row.unit_price_override != null ? Number(row.unit_price_override) : null
    const unitPrice = Number.isFinite(overridePrice as number)
      ? (overridePrice as number)
      : baseUnitPrice
    const recalcInputs =
      dec.decoration_method === 'screenprint' &&
      dec.width_mm != null &&
      dec.height_mm != null &&
      dec.colour_count != null &&
      loc?.placement_key != null
        ? {
            method: 'screenprint' as const,
            widthMm: dec.width_mm,
            heightMm: dec.height_mm,
            colourCount: dec.colour_count,
            placementKey: loc.placement_key,
          }
        : null

    const overlay = buildOverlay(admin, row, printArea, art)

    out.push({
      linkId: row.id,
      decorationId: dec.id,
      name: dec.name,
      method: dec.decoration_method,
      positionLabel: loc?.location ?? null,
      unitPrice,
      artworkUrl: art?.public_url ?? null,
      artworkName: art?.name ?? null,
      snapshotUrl: row.snapshot_url,
      snapshotColorSwatchId: row.snapshot_color_swatch_id,
      isDefault: row.is_default === true,
      sortOrder: row.sort_order ?? 0,
      recalcInputs,
      overlay,
    })
  }
  return out
}

function buildOverlay(
  admin: SupabaseClient,
  row: RawLinkRow,
  printArea: RawPrintArea | null,
  artwork: RawArtwork | null,
): DecorationOverlay | null {
  if (!artwork) return null
  if (!printArea || !printArea.image_id) return null
  const rectX = toNum(printArea.rect_x)
  const rectY = toNum(printArea.rect_y)
  const rectW = toNum(printArea.rect_w)
  const rectH = toNum(printArea.rect_h)
  const placeX = toNum(row.placement_x)
  const placeY = toNum(row.placement_y)
  const placeW = toNum(row.placement_w)
  const placeH = toNum(row.placement_h)
  if (
    rectX == null ||
    rectY == null ||
    rectW == null ||
    rectH == null ||
    placeX == null ||
    placeY == null ||
    placeW == null ||
    placeH == null
  ) {
    return null
  }
  const rotation = toNum(row.placement_rotation_deg) ?? 0

  const transparentVariant = (artwork.variants ?? []).find(
    (v) => v.variant_type === 'transparent_png' && v.status === 'ready' && v.storage_path,
  )
  const variantUrl = transparentVariant?.storage_path
    ? admin.storage.from(ARTWORK_BUCKET).getPublicUrl(transparentVariant.storage_path).data
        .publicUrl
    : null

  return {
    imageId: printArea.image_id,
    rect: { x: rectX, y: rectY, w: rectW, h: rectH },
    placement: { x: placeX, y: placeY, w: placeW, h: placeH, rotation_deg: rotation },
    artworkUrl: variantUrl ?? artwork.public_url,
  }
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : null
}
