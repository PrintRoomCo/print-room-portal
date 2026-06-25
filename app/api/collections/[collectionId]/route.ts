import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { getCollectionWithDesigns, getAvailableDesigns, getCollectionByQuoteId } from '@/lib/collections-detail'
import { getLatestJobTrackerByQuoteId } from '@/lib/job-tracker-queries'
import {
  groupCatalogueFrontImageRows,
  pickCatalogueFrontImage,
  type CatalogueFrontImageRow,
} from '@/lib/shop/catalogue-front-image'

type QuoteWithLineItems = Record<string, unknown> & {
  line_items?: unknown[] | null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function withCatalogueFrontLineImages(
  adminClient: SupabaseClient,
  quote: QuoteWithLineItems,
): Promise<QuoteWithLineItems> {
  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : []
  const lineRecords = lineItems.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === 'object',
  )
  const catalogueItemIds = Array.from(
    new Set(
      lineRecords
        .map((item) => stringValue(item.catalogue_item_id ?? item.catalogueItemId))
        .filter((id): id is string => id != null),
    ),
  )
  if (catalogueItemIds.length === 0) return quote

  const variantIds = Array.from(
    new Set(
      lineRecords
        .map((item) => stringValue(item.variant_id ?? item.variantId))
        .filter((id): id is string => id != null),
    ),
  )

  const [{ data: imageRows }, { data: variantRows }] = await Promise.all([
    adminClient
      .from('b2b_catalogue_item_images')
      .select('catalogue_item_id, color_swatch_id, image_url, view, source, position')
      .in('catalogue_item_id', catalogueItemIds)
      .eq('is_published', true),
    variantIds.length > 0
      ? adminClient
          .from('product_variants')
          .select('id, color_swatch_id')
          .in('id', variantIds)
      : Promise.resolve({ data: [] }),
  ])

  const rowsByItemId = groupCatalogueFrontImageRows(
    (imageRows ?? []) as CatalogueFrontImageRow[],
  )
  const swatchByVariantId = new Map<string, string | null>()
  for (const row of (variantRows ?? []) as Array<{ id: string; color_swatch_id: string | null }>) {
    swatchByVariantId.set(row.id, row.color_swatch_id)
  }

  return {
    ...quote,
    line_items: lineItems.map((item) => {
      if (!item || typeof item !== 'object') return item
      const record = item as Record<string, unknown>
      const catalogueItemId = stringValue(record.catalogue_item_id ?? record.catalogueItemId)
      if (!catalogueItemId) return item
      const variantId = stringValue(record.variant_id ?? record.variantId)
      const imageUrl = pickCatalogueFrontImage(
        rowsByItemId.get(catalogueItemId) ?? [],
        variantId ? swatchByVariantId.get(variantId) ?? null : null,
      )
      return imageUrl ? { ...record, image_url: imageUrl, imageUrl } : item
    }),
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params

  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const email = user.email.toLowerCase()
  const adminClient = getSupabaseServer()

  // Try quote branch first
  const { data: quote } = await adminClient
    .from('quotes')
    .select('*')
    .eq('id', collectionId)
    .single()

  if (quote && quote.customer_email?.toLowerCase() === email) {
    const [linkedCollection, tracker] = await Promise.all([
      getCollectionByQuoteId(quote.id),
      getLatestJobTrackerByQuoteId(quote.id),
    ])

    const quoteWithImages = await withCatalogueFrontLineImages(adminClient, quote as QuoteWithLineItems)

    return NextResponse.json({
      mode: 'quote',
      quote: quoteWithImages,
      linkedCollection,
      tracker,
    })
  }

  // Collection branch
  const collection = await getCollectionWithDesigns(collectionId)
  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (collection.customer_email.toLowerCase() !== email) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const availableDesigns = await getAvailableDesigns(email)

  // Check for linked tracker (for approved collections)
  let tracker = null
  if (collection.quote_id) {
    tracker = await getLatestJobTrackerByQuoteId(collection.quote_id)
  }

  return NextResponse.json({
    mode: 'collection',
    collection,
    availableDesigns,
    tracker,
  })
}
