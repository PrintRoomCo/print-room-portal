import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import {
  groupCatalogueFrontImageRows,
  pickCatalogueFrontImage,
  type CatalogueFrontImageRow,
} from '@/lib/shop/catalogue-front-image'

interface ReviewImageLineInput {
  lineId: string
  catalogueItemId: string | null
  productId: string | null
  variantId: string | null
}

interface ResolvedReviewImageLine extends ReviewImageLineInput {
  resolvedCatalogueItemId: string
}

function asReviewImageLine(value: unknown): ReviewImageLineInput | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.lineId !== 'string') {
    return null
  }
  const catalogueItemId =
    typeof row.catalogueItemId === 'string' && row.catalogueItemId.length > 0
      ? row.catalogueItemId
      : null
  const productId =
    typeof row.productId === 'string' && row.productId.length > 0
      ? row.productId
      : null
  if (!catalogueItemId && !productId) return null
  const variantId = typeof row.variantId === 'string' && row.variantId.length > 0
    ? row.variantId
    : null
  return {
    lineId: row.lineId,
    catalogueItemId,
    productId,
    variantId,
  }
}

function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
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

  const grantedItemIds = new Set(
    await getGrantedCatalogueItemIds(
      auth.admin,
      auth.context.membershipId,
      auth.context.organizationId,
    ),
  )

  const productFallbackIds = unique(
    lines
      .filter((line) => !line.catalogueItemId)
      .map((line) => line.productId),
  )
  const itemIdByProductId = new Map<string, string>()
  if (productFallbackIds.length > 0) {
    const { data: productItems, error: productItemsError } = await auth.admin
      .from('b2b_catalogue_items')
      .select('id, source_product_id, b2b_catalogues!inner(organization_id, is_active)')
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', auth.context.organizationId)
      .eq('b2b_catalogues.is_active', true)
      .in('source_product_id', productFallbackIds)

    if (productItemsError) {
      return NextResponse.json({ error: productItemsError.message }, { status: 500 })
    }

    for (const row of (productItems ?? []) as Array<{ id: string; source_product_id: string }>) {
      if (!grantedItemIds.has(row.id) || itemIdByProductId.has(row.source_product_id)) continue
      itemIdByProductId.set(row.source_product_id, row.id)
    }
  }

  const allowedLines: ResolvedReviewImageLine[] = []
  for (const line of lines) {
    const resolvedCatalogueItemId =
      line.catalogueItemId && grantedItemIds.has(line.catalogueItemId)
        ? line.catalogueItemId
        : line.productId
          ? itemIdByProductId.get(line.productId) ?? null
          : null
    if (resolvedCatalogueItemId) {
      allowedLines.push({ ...line, resolvedCatalogueItemId })
    }
  }
  const allowedItemIds = unique(allowedLines.map((line) => line.resolvedCatalogueItemId))

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

  const rowsByItemId = groupCatalogueFrontImageRows(
    (imageRows ?? []) as CatalogueFrontImageRow[],
  )

  const imagesByLineId: Record<string, string> = {}
  for (const line of allowedLines) {
    const selectedSwatchId = line.variantId ? variantSwatchById.get(line.variantId) ?? null : null
    const imageUrl = pickCatalogueFrontImage(
      rowsByItemId.get(line.resolvedCatalogueItemId) ?? [],
      selectedSwatchId,
    )
    if (imageUrl) imagesByLineId[line.lineId] = imageUrl
  }

  return NextResponse.json({ imagesByLineId })
}
