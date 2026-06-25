import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { decorationSignature } from '@/lib/cart/types'
import {
  buildRebuildLines,
  type QuoteItemRebuildRow,
  type RebuildLine,
} from '@/lib/reorder/rebuild'
import {
  groupCatalogueFrontImageRows,
  pickCatalogueFrontImage,
  type CatalogueFrontImageRow,
} from '@/lib/shop/catalogue-front-image'

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  let body: { quoteId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const quoteId = body.quoteId
  if (!quoteId || typeof quoteId !== 'string') {
    return NextResponse.json({ error: 'quoteId required' }, { status: 400 })
  }

  // Org-scope guard — the quote MUST belong to the caller's org (prevents IDOR).
  const { data: quote, error: quoteErr } = await auth.admin
    .from('quotes')
    .select('id, organization_id')
    .eq('id', quoteId)
    .maybeSingle()
  if (quoteErr) return NextResponse.json({ error: quoteErr.message }, { status: 500 })
  if (!quote || quote.organization_id !== auth.context.organizationId) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // variant labels embed cleanly (variant_id is a real FK to product_variants);
  // product images do NOT (product_id is a text column → no PostgREST embed),
  // so they are fetched separately by id, mirroring lib/orders/job-tracker.ts.
  const { data: itemRows, error: itemsErr } = await auth.admin
    .from('quote_items')
    .select(
      `product_id, variant_id, product_name, quantity, decorations,
       ship_to_store_id, catalogue_item_id, catalogue_variant_label,
       qty_from_stock, qty_to_make,
       product_variants ( color_swatch_id, product_color_swatches(label), sizes(label) )`,
    )
    .eq('quote_id', quoteId)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  const raw = (itemRows ?? []) as Array<Record<string, unknown>>

  const productIds = Array.from(
    new Set(
      raw
        .map((r) => r.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const imageByProductId = new Map<string, string | null>()
  if (productIds.length > 0) {
    const { data: products } = await auth.admin
      .from('products')
      .select('id, image_url')
      .in('id', productIds)
    for (const p of (products ?? []) as Array<{ id: string; image_url: string | null }>) {
      imageByProductId.set(p.id, p.image_url)
    }
  }

  const catalogueItemIds = Array.from(
    new Set(
      raw
        .map((r) => r.catalogue_item_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  let catalogueImageRowsByItemId = new Map<string, CatalogueFrontImageRow[]>()
  if (catalogueItemIds.length > 0) {
    const { data: catalogueImages } = await auth.admin
      .from('b2b_catalogue_item_images')
      .select('catalogue_item_id, color_swatch_id, image_url, view, source, position')
      .in('catalogue_item_id', catalogueItemIds)
      .eq('is_published', true)
    catalogueImageRowsByItemId = groupCatalogueFrontImageRows(
      (catalogueImages ?? []) as CatalogueFrontImageRow[],
    )
  }

  const rows: QuoteItemRebuildRow[] = raw.map((r) => {
    const pv = pickOne(r.product_variants as unknown)
    const swatch = pv ? pickOne((pv as Record<string, unknown>).product_color_swatches) : null
    const size = pv ? pickOne((pv as Record<string, unknown>).sizes) : null
    const productId = typeof r.product_id === 'string' ? r.product_id : null
    const catalogueItemId = (r.catalogue_item_id as string | null) ?? null
    const selectedSwatchId =
      pv && typeof (pv as Record<string, unknown>).color_swatch_id === 'string'
        ? ((pv as Record<string, unknown>).color_swatch_id as string)
        : null
    const catalogueFrontImage = catalogueItemId
      ? pickCatalogueFrontImage(
          catalogueImageRowsByItemId.get(catalogueItemId) ?? [],
          selectedSwatchId,
        )
      : null
    return {
      product_id: productId,
      variant_id: (r.variant_id as string | null) ?? null,
      product_name: (r.product_name as string) ?? 'Item',
      quantity: Number(r.quantity ?? 0),
      decorations: r.decorations,
      ship_to_store_id: (r.ship_to_store_id as string | null) ?? null,
      catalogue_item_id: catalogueItemId,
      catalogue_variant_label: (r.catalogue_variant_label as string | null) ?? null,
      qty_from_stock: Number(r.qty_from_stock ?? 0),
      qty_to_make: Number(r.qty_to_make ?? 0),
      colour_label: (swatch as { label?: string } | null)?.label ?? null,
      size_label: (size as { label?: string } | null)?.label ?? null,
      image_url: catalogueFrontImage ?? (productId ? imageByProductId.get(productId) ?? null : null),
    }
  })

  const { lines, degradedCount } = buildRebuildLines(rows)

  // Fresh price — never restore the historical snapshot. Aggregate qty by the
  // SAME key submit.ts (lib/checkout/submit.ts:423) and the cart's
  // recomputeProductTierPrices use: `${product_id}::${decorationSignature}`. A
  // product split across two decoration sets then tiers each set on its own qty,
  // so our display price matches what the cart recomputes on /cart (no flicker).
  // effective_unit_price is keyed by product_id (decoration price is layered by
  // the cart), so we price per product but at the per-signature total qty — the
  // productId is the key prefix up to the first "::" (signatures never contain it).
  const aggKey = (l: RebuildLine) => `${l.productId}::${decorationSignature(l.decorations)}`
  const totalQtyByKey = new Map<string, number>()
  for (const l of lines) {
    const k = aggKey(l)
    totalQtyByKey.set(k, (totalQtyByKey.get(k) ?? 0) + l.qty)
  }
  const priceByKey = new Map<string, number>()
  await Promise.all(
    Array.from(totalQtyByKey.entries()).map(async ([key, totalQty]) => {
      const productId = key.slice(0, key.indexOf('::'))
      const { data: unit } = await auth.admin.rpc('effective_unit_price', {
        p_product_id: productId,
        p_org_id: auth.context.organizationId,
        p_qty: totalQty,
      })
      priceByKey.set(key, Number(unit ?? 0))
    }),
  )

  const priced: RebuildLine[] = lines.map((l) => ({
    ...l,
    unitPrice: priceByKey.get(aggKey(l)) ?? 0,
  }))

  return NextResponse.json({ lines: priced, degradedCount })
}
