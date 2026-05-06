export interface CatalogueAwareGalleryImage {
  id: string
  url: string
  view: string | null
  alt?: string | null
  position?: number | null
  color_swatch_id?: string | null
  scope?: 'catalogue' | 'master'
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

function imagePriority(
  image: CatalogueAwareGalleryImage,
  selectedColorSwatchId: string | null,
): number | null {
  const scope = image.scope ?? 'master'
  const imageColor = image.color_swatch_id ?? null

  if (scope === 'catalogue' && imageColor && imageColor === selectedColorSwatchId) return 1
  if (scope === 'catalogue' && imageColor == null) return 2
  if (scope === 'master' && imageColor && imageColor === selectedColorSwatchId) return 3
  if (scope === 'master' && imageColor == null) return 4

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

function compareImages(a: CatalogueAwareGalleryImage, b: CatalogueAwareGalleryImage) {
  const heroFirst = (img: CatalogueAwareGalleryImage) => (img.view === 'hero' ? 0 : 1)
  const heroDelta = heroFirst(a) - heroFirst(b)
  if (heroDelta !== 0) return heroDelta

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
