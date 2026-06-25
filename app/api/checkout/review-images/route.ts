import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import { normalizeCatalogueImageView } from '@/lib/shop/catalogue-image-view'

interface ReviewImageLineInput {
  lineId: string
  catalogueItemId: string
  variantId: string | null
}

interface CatalogueImageRow {
  catalogue_item_id: string
  color_swatch_id: string | null
  view: string | null
  source: string | null
  position: number | null
  image_url: string | null
}

function asReviewImageLine(value: unknown): ReviewImageLineInput | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.lineId !== 'string' || typeof row.catalogueItemId !== 'string') {
    return null
  }
  const variantId = typeof row.variantId === 'string' && row.variantId.length > 0
    ? row.variantId
    : null
  return {
    lineId: row.lineId,
    catalogueItemId: row.catalogueItemId,
    variantId,
  }
}

function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function sourceRank(source: string | null): number {
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

function pickFrontImage(rows: CatalogueImageRow[], selectedSwatchId: string | null): string | null {
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

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  let body: { lines?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.lines)) {
    return NextResponse.json({ error: 'lines required' }, { status: 400 })
  }

  const lines = body.lines
    .slice(0, 100)
    .map(asReviewImageLine)
    .filter((line): line is ReviewImageLineInput => line != null)

  if (lines.length === 0) {
    return NextResponse.json({ imagesByLineId: {} })
  }

  const itemIds = unique(lines.map((line) => line.catalogueItemId))
  const grantedItemIds = new Set(
    await getGrantedCatalogueItemIds(
      auth.admin,
      auth.context.membershipId,
      auth.context.organizationId,
    ),
  )
  const allowedItemIds = itemIds.filter((id) => grantedItemIds.has(id))
  const allowedLines = lines.filter((line) => grantedItemIds.has(line.catalogueItemId))

  if (allowedItemIds.length === 0 || allowedLines.length === 0) {
    return NextResponse.json({ imagesByLineId: {} })
  }

  const variantSwatchById = new Map<string, string | null>()
  const variantIds = unique(allowedLines.map((line) => line.variantId))
  if (variantIds.length > 0) {
    const { data: variants, error: variantsError } = await auth.admin
      .from('product_variants')
      .select('id, color_swatch_id')
      .in('id', variantIds)

    if (variantsError) {
      return NextResponse.json({ error: variantsError.message }, { status: 500 })
    }

    for (const row of (variants ?? []) as Array<{ id: string; color_swatch_id: string | null }>) {
      variantSwatchById.set(row.id, row.color_swatch_id)
    }
  }

  const { data: imageRows, error: imageError } = await auth.admin
    .from('b2b_catalogue_item_images')
    .select('catalogue_item_id, color_swatch_id, view, source, position, image_url')
    .in('catalogue_item_id', allowedItemIds)
    .eq('is_published', true)

  if (imageError) {
    return NextResponse.json({ error: imageError.message }, { status: 500 })
  }

  const rowsByItemId = new Map<string, CatalogueImageRow[]>()
  for (const row of (imageRows ?? []) as CatalogueImageRow[]) {
    const group = rowsByItemId.get(row.catalogue_item_id) ?? []
    group.push(row)
    rowsByItemId.set(row.catalogue_item_id, group)
  }

  const imagesByLineId: Record<string, string> = {}
  for (const line of allowedLines) {
    const selectedSwatchId = line.variantId ? variantSwatchById.get(line.variantId) ?? null : null
    const imageUrl = pickFrontImage(rowsByItemId.get(line.catalogueItemId) ?? [], selectedSwatchId)
    if (imageUrl) imagesByLineId[line.lineId] = imageUrl
  }

  return NextResponse.json({ imagesByLineId })
}
