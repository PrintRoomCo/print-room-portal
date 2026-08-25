import type { SupabaseClient } from '@supabase/supabase-js'
import type { CartLineBracket } from '@/lib/cart/types'
import {
  ladderPriceAt,
  normalizeLadderBrackets,
  type DecorationLadderRow,
} from '@/lib/pricing/decoration-ladder'
import type { ResolvedRenditionPresentation } from './decoration-renditions'

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
  /** Resolved file presentation by exact product_variants.id. This map changes
   * artwork/link/snapshot only; decorationId, price and ladder stay shared. */
  resolvedByVariantId?: Record<string, ResolvedRenditionPresentation>
  renditionId?: string
  renditionLabel?: string
  isDefault: boolean
  sortOrder: number
  /**
   * Inputs needed to recompute the unit price at customer qty.
   *   - screenprint: populated when all engine inputs are present
   *     (dims + colour count + placement). Price varies with qty.
   *   - embroidery: populated when the decoration is priceable off the stitch
   *     ladder — an actual stitch_count, or width+height for the provisional
   *     area estimate. The ladder is qty-independent; the same fetched price
   *     applies at every qty.
   * Null for legacy decorations created before the autofill flow, and for an
   * embroidery decoration with neither stitch_count nor dimensions — on a
   * computed-price item that means pricing-pending and the PDP blocks
   * add-to-cart (mirrors the RPC's NULL soft gate).
   */
  recalcInputs:
    | {
        method: 'screenprint'
        widthMm: number
        heightMm: number
        colourCount: number
        placementKey: string
      }
    | {
        method: 'embroidery'
        stitchCount: number | null
        widthMm: number | null
        heightMm: number | null
      }
    | null
  /**
   * Live PDP overlay payload — null when staff hasn't assigned a print area
   * or any required placement coord is missing.
   */
  overlay: DecorationOverlay | null
  /**
   * Pooled decoration pricing (2026-08-13 spec §5) — may this decoration's
   * quantity pool across garments that share it? Decided server-side so the
   * client can never widen eligibility: a real library decoration has an
   * artwork and a real method. The $0 `method='custom'` "Custom decoration"
   * placeholder is attached catalogue-wide, so pooling by decoration id would
   * pool entire catalogues — excluded structurally here, not by price.
   */
  poolable: boolean
  /**
   * The decoration's own authored price ladder (spec §3), normalised so that
   * exact-band matching reproduces the database's clamped lookup at every
   * quantity — see lib/pricing/decoration-ladder.ts. Null when no ladder is
   * authored, in which case pricing stays on today's engine/flat path.
   *
   * When present this is snapshotted onto the cart line as
   * `decorations[].brackets` INSTEAD of the client's probe-derived brackets. The
   * probe samples fixed breakpoints; a pooled quantity can land between them, and
   * a missed ladder band edge would make the cart claim one price and the server
   * RPC compute another — a drift 409 at checkout.
   */
  ladder: CartLineBracket[] | null
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
  stitch_count: number | null
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
    stitch_count,
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

  const resolvedByDecorationId = await loadResolvedRenditions(admin, catalogueItemId)

  // Per-decoration price ladders (spec §3). One batched read for the whole item.
  // A ladder is THE decoration price — it beats both the link override and the
  // flat unit price, matching effective_decoration_unit_price, which every other
  // customer price source already routes through. Without this the PDP's first
  // paint would be the only place still showing the pre-ladder figure.
  const ladderByDecorationId = await loadDecorationLadders(
    admin,
    rows
      .map((r) => pickOne(r.decoration)?.id)
      .filter((v): v is string => Boolean(v)),
  )

  const out: DecorationOption[] = []
  for (const row of rows) {
    const dec = pickOne(row.decoration)
    if (!dec || !dec.is_active) continue
    const ladderRows = ladderByDecorationId.get(dec.id) ?? null
    const art = pickOne(dec.artwork)
    const loc = pickOne(dec.location)
    const printArea = pickOne(row.print_area)
    const baseUnitPrice = Number(dec.unit_price)
    const overridePrice =
      row.unit_price_override != null ? Number(row.unit_price_override) : null
    const staticPrice = Number.isFinite(overridePrice as number)
      ? (overridePrice as number)
      : baseUnitPrice
    // First paint has no chosen quantity yet, so seed from the ladder at qty 1 —
    // which the DB clamps to the lowest band. The debounced /api/shop/decoration-pricing
    // recalc then moves it to the real (pooled) quantity.
    const ladderSeed = ladderPriceAt(ladderRows, 1)
    const unitPrice = ladderSeed ?? staticPrice
    const recalcInputs: DecorationOption['recalcInputs'] =
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
        : dec.decoration_method === 'embroidery' &&
            (dec.stitch_count != null ||
              (dec.width_mm != null && dec.height_mm != null))
          ? {
              method: 'embroidery' as const,
              stitchCount: dec.stitch_count,
              widthMm: dec.width_mm,
              heightMm: dec.height_mm,
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
      resolvedByVariantId: resolvedByDecorationId.get(dec.id) ?? {},
      isDefault: row.is_default === true,
      sortOrder: row.sort_order ?? 0,
      recalcInputs,
      overlay,
      poolable: art != null && dec.decoration_method !== 'custom',
      ladder: normalizeLadderBrackets(ladderRows),
    })
  }
  return out
}

interface ResolvedRenditionRpcRow {
  product_variant_id: string
  link_id: string
  org_decoration_id: string
  rendition_id: string
  rendition_label: string
  artwork_id: string
  artwork_name: string
  artwork_url: string
  overlay_storage_path: string | null
  snapshot_url: string | null
  resolution_source: 'exact_variant' | 'decoration_default'
}

async function loadResolvedRenditions(
  admin: SupabaseClient,
  catalogueItemId: string,
): Promise<Map<string, Record<string, ResolvedRenditionPresentation>>> {
  const result = new Map<string, Record<string, ResolvedRenditionPresentation>>()
  const { data: item, error: itemError } = await admin
    .from('b2b_catalogue_items')
    .select('source_product_id')
    .eq('id', catalogueItemId)
    .maybeSingle()
  if (itemError || !item?.source_product_id) return result

  const { data: variants, error: variantError } = await admin
    .from('product_variants')
    .select('id')
    .eq('product_id', item.source_product_id)
    .eq('is_active', true)
  if (variantError || !variants?.length) return result

  const { data, error } = await admin.rpc('resolve_catalogue_decoration_renditions', {
    p_catalogue_item_id: catalogueItemId,
    p_product_variant_ids: variants.map((variant) => variant.id),
  })
  if (error) {
    // During the rolling deployment the app may briefly precede the additive
    // migration. Falling back to the legacy parent artwork is intentional.
    console.error('[loadResolvedRenditions]', error)
    return result
  }

  for (const row of (data ?? []) as ResolvedRenditionRpcRow[]) {
    const byVariant = result.get(row.org_decoration_id) ?? {}
    const overlayUrl = row.overlay_storage_path
      ? admin.storage.from(ARTWORK_BUCKET).getPublicUrl(row.overlay_storage_path).data.publicUrl
      : null
    byVariant[row.product_variant_id] = {
      linkId: row.link_id,
      renditionId: row.rendition_id,
      renditionLabel: row.rendition_label,
      artworkId: row.artwork_id,
      artworkName: row.artwork_name,
      artworkUrl: row.artwork_url,
      overlayUrl,
      snapshotUrl: row.snapshot_url,
      resolutionSource: row.resolution_source,
    }
    result.set(row.org_decoration_id, byVariant)
  }
  return result
}

/**
 * Batched ladder read, chunked to keep the PostgREST `in` filter bounded (same
 * shape as the checkout link fetch). Returns an empty map on error rather than
 * throwing — a failed ladder read degrades to today's engine/flat pricing, which
 * is the pre-ladder behaviour, not a broken PDP.
 */
async function loadDecorationLadders(
  admin: SupabaseClient,
  decorationIds: string[],
): Promise<Map<string, DecorationLadderRow[]>> {
  const byDecoration = new Map<string, DecorationLadderRow[]>()
  const ids = Array.from(new Set(decorationIds))
  if (ids.length === 0) return byDecoration

  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from('org_decoration_pricing_tiers')
      .select('org_decoration_id, min_quantity, max_quantity, unit_price')
      .in('org_decoration_id', ids.slice(i, i + 100))
    if (error) {
      console.error('[loadDecorationLadders]', error)
      return new Map()
    }
    for (const r of (data ?? []) as Array<
      DecorationLadderRow & { org_decoration_id: string }
    >) {
      const bucket = byDecoration.get(r.org_decoration_id) ?? []
      bucket.push({
        min_quantity: r.min_quantity,
        max_quantity: r.max_quantity,
        unit_price: r.unit_price,
      })
      byDecoration.set(r.org_decoration_id, bucket)
    }
  }
  return byDecoration
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
