import { normalizeCatalogueImageView } from './catalogue-image-view'

export interface CatalogueFrontImageRow {
  catalogue_item_id: string
  color_swatch_id: string | null
  view: string | null
  source?: string | null
  position: number | null
  image_url: string | null
}

function sourceRank(source: string | null | undefined): number {
  if (source === 'staff_pick') return 0
  if (source === 'staff_upload') return 1
  if (source === 'designer_snapshot') return 2
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
