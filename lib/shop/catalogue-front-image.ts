import { normalizeCatalogueImageView } from './catalogue-image-view'

export interface CatalogueFrontImageRow {
  catalogue_item_id: string
  color_swatch_id: string | null
  view: string | null
  source?: string | null
  position: number | null
  image_url: string | null
}

/**
 * Source preference WITHIN a swatch tier, kept in step with the PDP's
 * `pickPreferredGalleryImage` (lib/shop/catalogue-images.ts), which resolves
 * `designer_snapshot` first. A designer snapshot is the decorated render of
 * this item — the picture the customer actually chose on the PDP — so it must
 * outrank the undecorated staff/supplier stock photography everywhere the same
 * line is shown again (cart, checkout, confirmation, reorder, collections).
 * Ranking staff fronts first made those surfaces contradict the PDP whenever an
 * item carried both for one colour.
 *
 * Note this is the tie-break AFTER `swatchRank`, so a staff front in the
 * selected colour still beats a snapshot of some other colour.
 */
function sourceRank(source: string | null | undefined): number {
  if (source === 'designer_snapshot') return 0
  if (source === 'staff_pick') return 1
  if (source === 'staff_upload') return 2
  return 3
}

function swatchRank(rowSwatchId: string | null, selectedSwatchId: string | null): number {
  if (selectedSwatchId && rowSwatchId === selectedSwatchId) return 0
  if (rowSwatchId == null) return 1
  return 2
}

export function groupCatalogueFrontImageRows(
  rows: CatalogueFrontImageRow[],
): Map<string, CatalogueFrontImageRow[]> {
  const byItemId = new Map<string, CatalogueFrontImageRow[]>()
  for (const row of rows) {
    const group = byItemId.get(row.catalogue_item_id) ?? []
    group.push(row)
    byItemId.set(row.catalogue_item_id, group)
  }
  return byItemId
}

export function pickCatalogueFrontImage(
  rows: CatalogueFrontImageRow[],
  selectedSwatchId: string | null = null,
): string | null {
  const frontRows = rows
    .filter((row) => row.image_url)
    .filter((row) => normalizeCatalogueImageView(row.view, row.image_url) === 'front')
    .sort((a, b) => {
      const swatchDelta =
        swatchRank(a.color_swatch_id, selectedSwatchId) -
        swatchRank(b.color_swatch_id, selectedSwatchId)
      if (swatchDelta !== 0) return swatchDelta

      const sourceDelta = sourceRank(a.source) - sourceRank(b.source)
      if (sourceDelta !== 0) return sourceDelta

      return (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER)
    })

  return frontRows[0]?.image_url ?? null
}
