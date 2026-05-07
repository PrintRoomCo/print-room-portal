export interface CatalogueAwareGalleryImage {
  id: string
  url: string
  view: string | null
  alt?: string | null
  position?: number | null
  color_swatch_id?: string | null
  scope?: 'catalogue' | 'master'
  source?: 'designer_snapshot' | 'staff_upload' | null
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
  const idx = THUMBNAIL_VIEW_PREFERENCE.indexOf(view.toLowerCase())
  return idx === -1 ? 50 : idx
}

function thumbnailSourceRank(source: string | null): number {
  if (source === 'designer_snapshot') return 0
  if (source === 'staff_upload') return 1
  return 9
}

export function pickCatalogueItemThumbnail(
  fallbackUrl: string | null,
  rows: CatalogueItemImageRow[],
): string | null {
  const candidate = rows
    .filter((r) => r.image_url && r.color_swatch_id == null)
    .sort((a, b) => {
      const sd = thumbnailSourceRank(a.source) - thumbnailSourceRank(b.source)
      if (sd !== 0) return sd
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

    const key = image.view ?? `image:${image.id}`
    const current = chosenByView.get(key)
    if (!current || compareCandidates(image, priority, current.image, current.priority) < 0) {
      chosenByView.set(key, { image, priority })
    }
  }

  return Array.from(chosenByView.values())
    .map((entry) => entry.image)
    .sort(compareImages)
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

  if (scope === 'catalogue' && imageColor && imageColor === selectedColorSwatchId) return 1
  if (scope === 'catalogue' && imageColor == null) return 2
  if (scope === 'master' && imageColor && imageColor === selectedColorSwatchId) return 3
  if (scope === 'master' && imageColor == null) {
    const view = (image.view ?? '').toLowerCase()
    if (PRIMARY_VIEWS.has(view)) return 4
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
  const idx = VIEW_ORDER.indexOf(view.toLowerCase())
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
