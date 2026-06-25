import { notFound } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { SetTopBarContext } from '@/components/layout/PortalTopBarContext'
import {
  ConfirmationView,
  type ConfirmationDecoration,
  type ConfirmationLine,
  type ConfirmationAddress,
} from './ConfirmationView'
import {
  groupCatalogueFrontImageRows,
  pickCatalogueFrontImage,
  type CatalogueFrontImageRow,
} from '@/lib/shop/catalogue-front-image'

const GST_RATE = 0.15

interface OrderRow {
  id: string
  status: string | null
  total_price: number | null
  intent: string | null
  quotes: {
    id: string
    order_ref: string | null
    monday_item_id: string | null
    organization_id: string | null
    subtotal: number | null
    decoration_cost: number | null
    tax: number | null
    shipping_address: unknown
    required_by: string | null
  } | null
}

interface QuoteItemRow {
  id: string
  // `text` in the DB (legacy from Shopify import era) — no FK to products.id,
  // which is why the master product image is fetched in a separate query
  // below rather than embedded here.
  product_id: string | null
  product_name: string | null
  catalogue_item_id: string | null
  quantity: number | null
  unit_price: number | null
  decorations: unknown
  ship_to_store_id: string | null
  product_variants:
    | {
        color_swatch_id: string | null
        product_color_swatches: { label: string | null } | { label: string | null }[] | null
        sizes: { label: string | null } | { label: string | null }[] | null
      }
    | null
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function asAddress(value: unknown): ConfirmationAddress | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const pick = (k: string): string | null =>
    typeof v[k] === 'string' && (v[k] as string).length > 0 ? (v[k] as string) : null
  const out: ConfirmationAddress = {
    name: pick('name'),
    address: pick('address'),
    city: pick('city'),
    state: pick('state'),
    postal_code: pick('postal_code'),
    country: pick('country'),
  }
  // Treat as null if every field is empty so the UI can show the fallback line.
  const hasAny = Object.values(out).some((x) => x !== null)
  return hasAny ? out : null
}

function asDecorations(value: unknown): ConfirmationDecoration[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw): ConfirmationDecoration | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const name = typeof r.name === 'string' ? r.name : null
      if (!name) return null
      const unitPrice = Number(r.unitPrice ?? r.unit_price ?? 0)
      return {
        linkId: typeof r.linkId === 'string' ? r.linkId : null,
        name,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        snapshotUrl: typeof r.snapshotUrl === 'string' ? r.snapshotUrl : null,
        artworkUrl: typeof r.artworkUrl === 'string' ? r.artworkUrl : null,
        positionLabel:
          typeof r.positionLabel === 'string' ? r.positionLabel : null,
      }
    })
    .filter((x): x is ConfirmationDecoration => x !== null)
}

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  const { data } = await admin
    .from('orders')
    .select(
      `id, status, total_price, intent,
       quotes!inner (
         id, order_ref, monday_item_id, organization_id,
         subtotal, decoration_cost, tax,
         shipping_address, required_by
       )`,
    )
    .eq('id', orderId)
    .single()
  const order = data as unknown as OrderRow | null
  if (!order) {
    console.error('[confirmation] order_not_found', { orderId, userId: context.userId })
    return notFound()
  }
  if (!order.quotes) {
    console.error('[confirmation] missing_quote_join', { orderId })
    return notFound()
  }
  if (order.quotes.organization_id !== context.organizationId) {
    console.error('[confirmation] org_mismatch', {
      orderId,
      userId: context.userId,
      userOrgId: context.organizationId,
    })
    return notFound()
  }

  const orderRef = order.quotes.order_ref ?? '—'
  const awaitingApproval = order.status === 'awaiting-approval'
  const mondaySynced = Boolean(order.quotes.monday_item_id)
  const isInventoryOrder = order.intent === 'inventory'

  // Stored total_amount / total_price is ex-GST (matches Xero invoice convention).
  // Re-derive the inc-GST view the cart showed so the customer doesn't see a
  // different total than the one they agreed to at checkout.
  const subtotalExGst = Number(order.quotes.subtotal ?? order.total_price ?? 0)
  const decorationCost = Number(order.quotes.decoration_cost ?? 0)
  const storedTax = Number(order.quotes.tax ?? 0)
  const gst = storedTax > 0 ? storedTax : Math.round(subtotalExGst * GST_RATE * 100) / 100
  const totalIncGst = Math.round((subtotalExGst + gst) * 100) / 100

  // Line items live on the joined quote. We surface them on the confirmation
  // card so the customer can scan what they actually placed; if this fetch
  // fails for any reason we still render the rest of the page.
  const { data: rawLines, error: linesError } = await admin
    .from('quote_items')
    .select(
      `id, product_id, product_name, catalogue_item_id, quantity, unit_price, decorations, ship_to_store_id,
       product_variants (
         color_swatch_id,
         product_color_swatches (label),
         sizes (label)
       )`,
    )
    .eq('quote_id', order.quotes.id)
  if (linesError) {
    console.error('[confirmation] lines_query_failed', {
      orderId,
      quoteId: order.quotes.id,
      message: linesError.message,
    })
  }

  const lineRows = (rawLines ?? []) as unknown as QuoteItemRow[]
  if (lineRows.length === 0) {
    // Surface so we notice — this fallback used to claim items would appear
    // "once they finish syncing", which was never true. Real cause is almost
    // always a misconfigured quote join.
    console.error('[confirmation] empty_lines', { orderId, quoteId: order.quotes.id })
  }

  // Master product images. We resolve via a separate fetch keyed by
  // quote_items.product_id because that column is `text` (legacy) with no FK
  // to products.id, so PostgREST can't auto-embed it. This is also the only
  // image path that works for variantless lines (e.g. cap bulk orders, the
  // BG master-products carve-out from 2026-05-15) — product_variants embeds
  // resolve to null there.
  const productIds = Array.from(
    new Set(
      lineRows
        .map((r) => r.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const productImageById = new Map<string, string | null>()
  if (productIds.length > 0) {
    const { data: productImageRows, error: productImageErr } = await admin
      .from('products')
      .select('id, image_url')
      .in('id', productIds)
    if (productImageErr) {
      console.error('[confirmation] product_image_lookup_failed', {
        orderId,
        message: productImageErr.message,
      })
    }
    for (const row of (productImageRows ?? []) as Array<{ id: string; image_url: string | null }>) {
      productImageById.set(row.id, row.image_url)
    }
  }

  const catalogueItemIds = Array.from(
    new Set(
      lineRows
        .map((r) => r.catalogue_item_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  let catalogueImageRowsByItemId = new Map<string, CatalogueFrontImageRow[]>()
  if (catalogueItemIds.length > 0) {
    const { data: catalogueImageRows, error: catalogueImageErr } = await admin
      .from('b2b_catalogue_item_images')
      .select('catalogue_item_id, color_swatch_id, image_url, view, source, position')
      .in('catalogue_item_id', catalogueItemIds)
      .eq('is_published', true)
    if (catalogueImageErr) {
      console.error('[confirmation] catalogue_image_lookup_failed', {
        orderId,
        message: catalogueImageErr.message,
      })
    }
    catalogueImageRowsByItemId = groupCatalogueFrontImageRows(
      (catalogueImageRows ?? []) as CatalogueFrontImageRow[],
    )
  }

  const lines: ConfirmationLine[] = lineRows.map((row) => {
    const variant = row.product_variants
    const swatch = pickOne(variant?.product_color_swatches ?? null)
    const size = pickOne(variant?.sizes ?? null)
    const variantLabel =
      [swatch?.label, size?.label].filter(Boolean).join(' / ') || null
    const productImage =
      row.product_id ? productImageById.get(row.product_id) ?? null : null
    const catalogueFrontImage =
      row.catalogue_item_id
        ? pickCatalogueFrontImage(
            catalogueImageRowsByItemId.get(row.catalogue_item_id) ?? [],
            variant?.color_swatch_id ?? null,
          )
        : null
    return {
      id: row.id,
      productName: row.product_name ?? 'Item',
      variantLabel,
      quantity: Number(row.quantity ?? 0),
      unitPrice: Number(row.unit_price ?? 0),
      imageUrl: catalogueFrontImage ?? productImage,
      catalogueFrontImageUrl: catalogueFrontImage,
      decorations: asDecorations(row.decorations),
    }
  })

  // Fulfilment label — multi-store split vs single ship-to vs make-to-stock
  // signals already live on quote_items.ship_to_store_id. We summarise without
  // re-fetching the store rows: the per-line address detail is implicitly the
  // order-level shipping_address fallback below.
  const distinctShipTo = new Set(
    lineRows.map((r) => r.ship_to_store_id ?? '__custom__'),
  )
  const fulfilmentLabel =
    distinctShipTo.size > 1
      ? `Split across ${distinctShipTo.size} delivery locations`
      : 'Single delivery'

  const shippingAddress = asAddress(order.quotes.shipping_address)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SetTopBarContext value={{ kind: 'section', label: 'Order confirmation' }} />
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[var(--portal-topbar-h,76px)] md:px-6 md:pt-[120px]">
        <ConfirmationView
          orderId={order.id}
          orderRef={orderRef}
          status={order.status}
          awaitingApproval={awaitingApproval}
          mondaySynced={mondaySynced}
          isInventoryOrder={isInventoryOrder}
          customerEmail={context.email}
          shippingAddress={shippingAddress}
          fulfilmentLabel={fulfilmentLabel}
          requiredBy={order.quotes.required_by}
          lines={lines}
          subtotalExGst={subtotalExGst}
          decorationCost={decorationCost}
          gst={gst}
          totalIncGst={totalIncGst}
          gstRate={GST_RATE}
        />
      </div>
    </div>
  )
}
