import { normalizeCatalogueImageView } from './catalogue-image-view'

export interface CatalogueAwareGalleryImage {
  id: string
  url: string
  view: string | null
  alt?: string | null
  position?: number | null
  color_swatch_id?: string | null
  scope?: 'catalogue' | 'master'
  source?: 'designer_snapshot' | 'staff_upload' | 'staff_pick' | null
}

export interface CatalogueItemImageRow {
  catalogue_item_id: string
  view: string | null
  source: string | null
  position: number | null
  image_url: string | null
  color_swatch_id: string | null
}

export interface CardFallbackImage {
  color_swatch_id: string | null
  view: string | null
  source: string | null
  position: number | null
  image_url: string | null
}

/**
 * Snapshot-excluded, per-colour-aware card derive. The SINGLE source of card
 * fallback ordering, replicated identically in print-room-staff-portal and locked
 * by a shared test vector — do not let the two drift.
 *
 * Order: all-colours `front` -> lead colour's `front` -> first all-colours by
 * position (any view) -> masterImageUrl -> null. designer_snapshot rows are
 * always excluded from the derive (a snapshot only becomes the card via an
 * explicit pick, handled by the caller before this runs).
 */
export function deriveCardImageUrl(args: {
  images: CardFallbackImage[]
  leadColorSwatchId: string | null
  masterImageUrl: string | null
  normalizeView: (view: string | null) => string | null
}): string | null {
  const { images, leadColorSwatchId, masterImageUrl, normalizeView } = args
  const isFront = (v: string | null) => normalizeView(v) === 'front'
  const byPos = (arr: CardFallbackImage[]) =>
    arr.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const eligible = images.filter((i) => i.image_url && i.source !== 'designer_snapshot')
  const allColours = byPos(eligible.filter((i) => i.color_swatch_id == null))
  const acFront = allColours.find((i) => isFront(i.view))
  if (acFront?.image_url) return acFront.image_url
  if (leadColorSwatchId) {
    const leadFront = byPos(
      eligible.filter((i) => i.color_swatch_id === leadColorSwatchId && isFront(i.view)),
    )[0]
    if (leadFront?.image_url) return leadFront.image_url
  }
  if (allColours[0]?.image_url) return allColours[0].image_url
  return masterImageUrl ?? null
}

export function pickCatalogueItemThumbnail(
  fallbackUrl: string | null,
  rows: CatalogueItemImageRow[],
  leadColorSwatchId: string | null = null,
): string | null {
  return deriveCardImageUrl({
    images: rows.map((r) => ({
      color_swatch_id: r.color_swatch_id,
      view: r.view,
      source: r.source,
      position: r.position,
      image_url: r.image_url,
    })),
    leadColorSwatchId,
    masterImageUrl: fallbackUrl,
    normalizeView: (v) => normalizeCatalogueImageView(v),
  })
}

export function resolveGalleryImagesForColour(
  images: CatalogueAwareGalleryImage[],
  selectedColorSwatchId: string | null,
): CatalogueAwareGalleryImage[] {
  const chosenByView = new Map<
    string,
    { image: CatalogueAwareGalleryImage; priority: number }
  >()

  for (const image of images) {
    const priority = imagePriority(image, selectedColorSwatchId)
    if (priority == null) continue

    const key = normalizeCatalogueImageView(image.view, image.url) ?? image.view ?? `image:${image.id}`
    const current = chosenByView.get(key)
    if (!current || compareCandidates(image, priority, current.image, current.priority) < 0) {
      chosenByView.set(key, { image, priority })
    }
  }

  const entries = Array.from(chosenByView.values())
  // Priority 5 is the generic, null-colour master image — the blank garment for
  // a view nothing better covers. Drop it whenever ANY better image survives:
  // a catalogue pin (p1–p3) OR the colour's OWN master photo (p4, e.g. its real
  // back). Keeping p4 is what surfaces Forest Green's actual back on the PDP
  // while the generic back/side marketing shots fall away. The generic stays
  // only as the last resort so the gallery never empties.
  const hasBetterThanGenericFallback = entries.some((entry) => entry.priority < 5)
  const filtered = hasBetterThanGenericFallback
    ? entries.filter((entry) => entry.priority !== 5)
    : entries
  const kept = filtered.length > 0 ? filtered : entries

  return kept.map((entry) => entry.image).sort(compareImages)
}

export function pickPreferredGalleryImage(
  images: CatalogueAwareGalleryImage[],
  selectedColorSwatchId: string | null,
): CatalogueAwareGalleryImage | null {
  const ordered = resolveGalleryImagesForColour(images, selectedColorSwatchId)
  if (selectedColorSwatchId) {
    return (
      ordered.find(
        (img) =>
          img.source === 'designer_snapshot' &&
          img.color_swatch_id === selectedColorSwatchId,
      ) ??
      ordered.find(
        (img) => img.source === 'designer_snapshot' && img.color_swatch_id == null,
      ) ??
      ordered.find((img) => img.color_swatch_id === selectedColorSwatchId) ??
      ordered[0] ??
      null
    )
  }

  return ordered.find((img) => img.source === 'designer_snapshot') ?? ordered[0] ?? null
}

export function pickPreferredGalleryImageUrl(
  images: CatalogueAwareGalleryImage[],
  selectedColorSwatchId: string | null,
  fallbackUrl: string | null,
): string | null {
  return pickPreferredGalleryImage(images, selectedColorSwatchId)?.url ?? fallbackUrl
}

const PRIMARY_VIEWS = new Set([
  'front',
  'back',
  'left',
  'right',
  'side',
  'top',
  'bottom',
])

function imagePriority(
  image: CatalogueAwareGalleryImage,
  selectedColorSwatchId: string | null,
): number | null {
  const scope = image.scope ?? 'master'
  const imageColor = image.color_swatch_id ?? null
  const source = image.source ?? 'staff_upload'

  if (
    scope === 'catalogue' &&
    image.source === 'designer_snapshot' &&
    imageColor &&
    imageColor === selectedColorSwatchId
  ) {
    return 1
  }
  if (
    scope === 'catalogue' &&
    (source === 'staff_upload' || source === 'staff_pick') &&
    imageColor &&
    imageColor === selectedColorSwatchId
  ) {
    return 2
  }
  if (scope === 'catalogue' && imageColor == null) return 3
  if (scope === 'master' && imageColor && imageColor === selectedColorSwatchId) return 4
  if (scope === 'master' && imageColor == null) {
    const view = (image.view ?? '').toLowerCase()
    const normalizedView = normalizeCatalogueImageView(view, image.url) ?? view
    if (PRIMARY_VIEWS.has(normalizedView)) return 5
    return null
  }

  return null
}

function compareCandidates(
  a: CatalogueAwareGalleryImage,
  aPriority: number,
  b: CatalogueAwareGalleryImage,
  bPriority: number,
) {
  if (aPriority !== bPriority) return aPriority - bPriority
  return compareImages(a, b)
}

const VIEW_ORDER = ['front', 'back', 'left_sleeve', 'right_sleeve', 'left', 'right', 'top', 'bottom', 'side']

function viewOrderRank(view: string | null | undefined) {
  if (!view) return VIEW_ORDER.length
  const normalized = normalizeCatalogueImageView(view) ?? view.toLowerCase()
  const idx = VIEW_ORDER.indexOf(normalized)
  return idx === -1 ? VIEW_ORDER.length : idx
}

function compareImages(a: CatalogueAwareGalleryImage, b: CatalogueAwareGalleryImage) {
  const viewRankDelta = viewOrderRank(a.view) - viewOrderRank(b.view)
  if (viewRankDelta !== 0) return viewRankDelta

  const positionDelta =
    (a.position ?? Number.MAX_SAFE_INTEGER) -
    (b.position ?? Number.MAX_SAFE_INTEGER)
  if (positionDelta !== 0) return positionDelta

  const viewDelta = naturalCompare(a.view ?? '', b.view ?? '')
  if (viewDelta !== 0) return viewDelta

  return naturalCompare(a.id, b.id)
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
