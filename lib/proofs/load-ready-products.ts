// MIRROR: keep in sync with
// `print-room-staff-portal/src/lib/proofs/load-ready-products.ts`.
// The customer portal vendors this helper so `autofillProofForOrder` can run
// inside the checkout submit path without round-tripping to the staff portal.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CatalogueProofProduct,
  CatalogueProofProductColour,
  CatalogueProofProductDecoration,
  CatalogueProofProductGreyed,
  ReadyProductsResult,
} from '@/lib/proofs/types'

interface RawDecoration {
  id: string
  is_published?: boolean | null
  decoration?: {
    id?: string
    name?: string | null
    decoration_method?: string | null
    artwork_id?: string | null
    width_mm?: number | string | null
    height_mm?: number | string | null
    artwork?: {
      id?: string
      name?: string | null
      public_url?: string | null
    } | null
  } | null
  print_area?: {
    id?: string
    name?: string | null
    view?: string | null
  } | null
  snapshot_url?: string | null
}

interface RawCatalogueItem {
  id: string
  catalogue_id: string
  source_product_id: string
  name: string
  is_active: boolean
  decorations?: RawDecoration[] | null
  colors?: RawColor[] | null
  images?: RawImage[] | null
}

interface RawColor {
  catalogue_item_id?: string
  color_swatch_id: string | null
  sort_order: number | null
  is_default: boolean | null
  swatch?: {
    id?: string
    label?: string | null
    hex?: string | null
    image_url?: string | null
  } | null
}

interface RawImage {
  catalogue_item_id?: string
  color_swatch_id: string | null
  image_url: string | null
  view: string | null
  source: string | null
  position: number | null
  is_published?: boolean | null
}

const ITEM_SELECT = `
  id,
  catalogue_id,
  source_product_id,
  name,
  is_active,
  decorations:b2b_catalogue_item_decorations(
    id,
    snapshot_url,
    is_published,
    decoration:org_decorations!b2b_catalogue_item_decorations_org_decoration_id_fkey(
      id,
      name,
      decoration_method,
      artwork_id,
      width_mm,
      height_mm,
      artwork:organization_artworks!org_decorations_artwork_id_fkey(
        id,
        name,
        public_url
      )
    ),
    print_area:product_print_areas!b2b_catalogue_item_decorations_print_area_id_fkey(
      id,
      name
    )
  ),
  colors:b2b_catalogue_item_colors(
    color_swatch_id,
    sort_order,
    is_default,
    swatch:product_color_swatches!b2b_catalogue_item_colors_color_swatch_id_fkey(
      id,
      label,
      hex,
      image_url
    )
  ),
  images:b2b_catalogue_item_images(
    color_swatch_id,
    image_url,
    view,
    source,
    position,
    is_published
  )
`

export async function loadReadyProductsForOrganization(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ReadyProductsResult> {
  const { data: catalogues, error: cataloguesError } = await admin
    .from('b2b_catalogues')
    .select('id')
    .eq('organization_id', organizationId)

  if (cataloguesError) {
    throw new Error(`Catalogue lookup failed: ${cataloguesError.message}`)
  }

  const catalogueIds = (catalogues ?? []).map((row: { id: string }) => row.id)
  if (catalogueIds.length === 0) return { products: [], greyed: [] }

  const { data: rawItems, error: itemsError } = await admin
    .from('b2b_catalogue_items')
    .select(ITEM_SELECT)
    .in('catalogue_id', catalogueIds)
    .order('sort_order', { ascending: true, nullsFirst: false })

  if (itemsError) {
    throw new Error(`Catalogue item lookup failed: ${itemsError.message}`)
  }

  const items = ((rawItems ?? []) as unknown as RawCatalogueItem[]).map(normalizeItem)
  const priceByProductId = await resolveUnitPrices(
    admin,
    organizationId,
    uniqueStrings(items.map((it) => it.source_product_id)),
  )

  const products: CatalogueProofProduct[] = []
  const greyed: CatalogueProofProductGreyed[] = []

  for (const item of items) {
    const reasons = collectGateFailures(item, priceByProductId.get(item.source_product_id) ?? 0)
    const view = toCatalogueProofProduct(item)
    if (reasons.length === 0) products.push(view)
    else greyed.push({ ...view, reasons })
  }

  return { products, greyed }
}

function collectGateFailures(item: RawCatalogueItem, unitPrice: number): string[] {
  const reasons: string[] = []
  if (!item.is_active) reasons.push('Inactive')

  const decorations = (item.decorations ?? []).map(normalizeDecoration)
  const readyDecoration = decorations.find(
    (d) => Boolean(d.decoration?.decoration_method) && Boolean(d.decoration?.artwork_id),
  )

  if (decorations.length === 0) {
    reasons.push('No decorations')
  } else if (!readyDecoration) {
    if (!decorations.some((d) => Boolean(d.decoration?.decoration_method))) {
      reasons.push('Decoration missing method')
    }
    if (!decorations.some((d) => Boolean(d.decoration?.artwork_id))) {
      reasons.push('Decoration missing artwork')
    }
  }

  if (!(unitPrice > 0)) reasons.push('No pricing')

  return reasons
}

function toCatalogueProofProduct(item: RawCatalogueItem): CatalogueProofProduct {
  const colours = (item.colors ?? [])
    .slice()
    .sort((a, b) => {
      const ad = a.is_default ? 0 : 1
      const bd = b.is_default ? 0 : 1
      if (ad !== bd) return ad - bd
      return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    })
    .map((row): CatalogueProofProductColour | null => {
      const swatch = pickOne(row.swatch)
      const swatchId = row.color_swatch_id ?? swatch?.id ?? null
      if (!swatchId) return null
      return {
        swatchId,
        label: swatch?.label ?? '',
        hex: swatch?.hex ?? null,
        imageUrl: swatch?.image_url ?? null,
      }
    })
    .filter((c): c is CatalogueProofProductColour => Boolean(c))

  const decorations = (item.decorations ?? [])
    .map(normalizeDecoration)
    .filter((d) => d.is_published === true)
    .filter((d) => Boolean(d.decoration?.decoration_method) && Boolean(d.decoration?.artwork_id))
    .map((d): CatalogueProofProductDecoration => ({
      linkId: d.id,
      decorationName: d.decoration?.name ?? '',
      method: d.decoration?.decoration_method ?? '',
      printAreaName: d.print_area?.name ?? null,
      widthMm: toFiniteNumber(d.decoration?.width_mm),
      heightMm: toFiniteNumber(d.decoration?.height_mm),
      artworkUrl: d.decoration?.artwork?.public_url ?? null,
      snapshotUrl: d.snapshot_url ?? null,
    }))

  const imageUrl = pickPrimaryImage(item)

  return {
    catalogueItemId: item.id,
    sourceProductId: item.source_product_id,
    name: item.name,
    imageUrl,
    colours,
    decorations,
  }
}

function pickPrimaryImage(item: RawCatalogueItem): string | null {
  const images = (item.images ?? []).filter(
    (row) => row.image_url && row.is_published === true,
  )
  if (images.length === 0) return null
  const sorted = images.slice().sort((a, b) => {
    const sd = sourceRank(a.source) - sourceRank(b.source)
    if (sd !== 0) return sd
    const vd = viewRank(a.view) - viewRank(b.view)
    if (vd !== 0) return vd
    return (a.position ?? 0) - (b.position ?? 0)
  })
  return sorted[0]?.image_url ?? null
}

function sourceRank(source: string | null) {
  if (source === 'designer_snapshot') return 0
  if (source === 'staff_upload') return 1
  if (source === 'staff_pick') return 1
  return 9
}

function viewRank(view: string | null) {
  const v = view?.toLowerCase() ?? ''
  if (v === 'hero') return 0
  if (v === 'front') return 1
  if (v === 'back') return 2
  return 5
}

function normalizeItem(item: RawCatalogueItem): RawCatalogueItem {
  return {
    ...item,
    decorations: (item.decorations ?? []).map(normalizeDecoration),
  }
}

function normalizeDecoration(row: RawDecoration): RawDecoration {
  const decoration = pickOne(row.decoration) ?? null
  return {
    ...row,
    decoration: decoration
      ? { ...decoration, artwork: pickOne(decoration.artwork) ?? null }
      : null,
    print_area: pickOne(row.print_area) ?? null,
  }
}

async function resolveUnitPrices(
  admin: SupabaseClient,
  organizationId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (productIds.length === 0) return map

  // effective_unit_price is the canonical price fn (memory:
  // project_b2b_pricing_canonical). get_unit_price would zero-price catalogue
  // items.
  await Promise.all(
    productIds.map(async (productId) => {
      const { data, error } = await admin.rpc('effective_unit_price', {
        p_product_id: productId,
        p_org_id: organizationId,
        p_qty: 1,
      })
      if (error) {
        map.set(productId, 0)
        return
      }
      const numeric = typeof data === 'number' ? data : Number(data)
      map.set(productId, Number.isFinite(numeric) ? numeric : 0)
    }),
  )

  return map
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  )
}

export type { ReadyProductsResult } from '@/lib/proofs/types'
