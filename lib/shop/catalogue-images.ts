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

const THUMBNAIL_VIEW_PREFERENCE = ['hero', 'front']

function thumbnailViewRank(view: string | null): number {
  if (!view) return 99
  const idx = THUMBNAIL_VIEW_PREFERENCE.indexOf(normalizeCatalogueImageView(view) ?? view.toLowerCase())
  return idx === -1 ? 50 : idx
}

function thumbnailSourceRank(source: string | null): number {
  if (source === 'designer_snapshot') return 0
  if (source === 'staff_upload') return 1
  if (source === 'staff_pick') return 1
  return 9
}

export function pickCatalogueItemThumbnail(
  fallbackUrl: string | null,
  rows: CatalogueItemImageRow[],
): string | null {
  const candidate = rows
    .filter((r) => r.image_url)
    .sort((a, b) => {
      const sd = thumbnailSourceRank(a.source) - thumbnailSourceRank(b.source)
      if (sd !== 0) return sd
      const cd = (a.color_swatch_id == null ? 0 : 1) - (b.color_swatch_id == null ? 0 : 1)
      if (cd !== 0) return cd
      const vd = thumbnailViewRank(a.view) - thumbnailViewRank(b.view)
      if (vd !== 0) return vd
      return (a.position ?? 0) - (b.position ?? 0)
    })[0]
  return candidate?.image_url ?? fallbackUrl
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
  'hero',
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

const VIEW_ORDER = ['hero', 'front', 'back', 'left_sleeve', 'right_sleeve', 'left', 'right', 'top', 'bottom', 'side']

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
