import { notFound } from 'next/navigation'
import {
  summariseDestinations,
  type DestinationSummary,
} from '@/lib/checkout/destination-summary'


/** Address snapshot to display lines, tolerating whatever shape was stored. */
function formatSnapshotAddress(snapshot: Record<string, unknown> | null): string[] {
  if (!snapshot) return []
  const pick = (key: string) => {
    const value = snapshot[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  }
  return [
    pick('name'),
    pick('address') ?? pick('street'),
    [pick('city'), pick('postal_code')].filter(Boolean).join(' ') || null,
    pick('country'),
  ].filter((line): line is string => Boolean(line))
}

/** Best-effort human name for an address snapshot row. */
function addressLabel(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) return null
  const name = typeof snapshot.name === 'string' ? snapshot.name.trim() : ''
  const city = typeof snapshot.city === 'string' ? snapshot.city.trim() : ''
  return name || city || null
}
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { billedFigures } from '@/lib/checkout/billed-figures'
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

interface OrderRow {
  id: string
  status: string | null
  total_price: number | null
  intent: string | null
  order_type: string | null
  quotes: {
    id: string
    order_ref: string | null
    monday_item_id: string | null
    organization_id: string | null
    subtotal: number | null
    decoration_cost: number | null
    tax: number | null
    picking_fee: number | null
    billed_total: number | null
    shipping_address: unknown
    required_by: string | null
    bill_country: string | null
    currency: string | null
    countries:
      | { name: string; tax_rate: number | string; tax_label: string }
      | Array<{ name: string; tax_rate: number | string; tax_label: string }>
      | null
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
  size_label: string | null
  product_variants:
    | {
        color_swatch_id: string | null
        product_color_swatches: { label: string | null } | { label: string | null }[] | null
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
      `id, status, total_price, intent, order_type,
       quotes!inner (
         id, order_ref, monday_item_id, organization_id,
         subtotal, decoration_cost, tax, picking_fee, billed_total,
         shipping_address, split_shipment, required_by, bill_country, currency,
         countries!quotes_bill_country_fkey(name, tax_rate, tax_label)
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

  const stampedCountry = pickOne(order.quotes.countries)
  let gstRate: number
  let taxLabel: string
  let currency: string
  let countryName: string | null
  if (order.quotes.bill_country && stampedCountry && order.quotes.currency) {
    gstRate = Number(stampedCountry.tax_rate)
    taxLabel = stampedCountry.tax_label
    currency = order.quotes.currency
    countryName = stampedCountry.name
  } else {
    // Historical pre-SP3 compatibility only: old quotes have no bill-country
    // stamp, so reconstruct from the org's current default country row (no
    // is_active filter — an immutable order outlives the platform kill switch).
    const { data: defaultRow } = await admin
      .from('organization_countries')
      .select('country_code, countries!inner(currency, tax_rate, tax_label)')
      .eq('organization_id', order.quotes.organization_id!)
      .eq('is_default', true)
      .maybeSingle()
    const joined = pickOne(
      (defaultRow as {
        countries?:
          | { currency: string; tax_rate: number | string; tax_label: string }
          | Array<{ currency: string; tax_rate: number | string; tax_label: string }>
      } | null)?.countries,
    )
    gstRate = joined ? Number(joined.tax_rate) : 0.15
    taxLabel = joined?.tax_label ?? `GST ${Math.round(gstRate * 100)}%`
    currency = order.quotes.currency ?? joined?.currency ?? 'NZD'
    countryName = null
  }

  const orderRef = order.quotes.order_ref ?? '—'
  const awaitingApproval = order.status === 'awaiting-approval'
  const mondaySynced = Boolean(order.quotes.monday_item_id)
  const isInventoryOrder = order.intent === 'inventory'

  // Stored subtotal / total_price is the ex-GST GOODS value; billed_total is
  // what we actually invoiced. Both are READ, not recomputed — billing_mode is
  // mutable, so re-deriving would rewrite the history of an old order.
  // Shared with the customer email so the two cannot disagree.
  const decorationCost = Number(order.quotes.decoration_cost ?? 0)
  const { billedExGst, pickingFee, prepaidGoodsValue } = billedFigures({
    goodsExGst: Number(order.quotes.subtotal ?? order.total_price ?? 0),
    billedTotal: order.quotes.billed_total,
    pickingFee: order.quotes.picking_fee,
  })
  const storedTax = Number(order.quotes.tax ?? 0)
  // storedTax was computed off the goods value, so it is only trustworthy when
  // nothing was zeroed. Otherwise derive GST from what is actually billed.
  const gst =
    prepaidGoodsValue === 0 && storedTax > 0
      ? storedTax
      : Math.round(billedExGst * gstRate * 100) / 100
  const totalIncGst = Math.round((billedExGst + gst) * 100) / 100

  // Line items live on the joined quote. We surface them on the confirmation
  // card so the customer can scan what they actually placed; if this fetch
  // fails for any reason we still render the rest of the page.
  const { data: rawLines, error: linesError } = await admin
    .from('quote_items')
    .select(
      `id, product_id, product_name, catalogue_item_id, quantity, unit_price, decorations, ship_to_store_id, size_label, destination_id,
       product_variants (
         color_swatch_id,
         product_color_swatches (label)
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
    const variantLabel =
      [swatch?.label, row.size_label].filter(Boolean).join(' / ') || null
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

  // Split shipment: the order says so on its header flag, so the old
  // ship_to_store_id heuristic is gone. Destinations carry their own snapshot
  // address, which is what makes this readable after a later store edit.
  const isSplitShipment = (order.quotes as { split_shipment?: boolean }).split_shipment === true
  let destinationSummaries: DestinationSummary[] = []
  let destinationAddressByRef: Record<string, Record<string, unknown> | null> = {}

  if (isSplitShipment) {
    const { data: destinationRows } = await admin
      .from('order_destinations')
      .select('id, position, ship_to_store_id, address_snapshot, split_fee')
      .eq('quote_id', order.quotes.id)
      .order('position')

    const rows = (destinationRows ?? []) as Array<{
      id: string
      position: number
      address_snapshot: Record<string, unknown> | null
      split_fee: number | null
    }>
    destinationAddressByRef = Object.fromEntries(
      rows.map((row) => [row.id, row.address_snapshot ?? null]),
    )
    destinationSummaries = summariseDestinations({
      destinations: rows.map((row) => ({
        ref: row.id,
        label: addressLabel(row.address_snapshot) ?? `Destination ${row.position}`,
      })),
      lines: lineRows.map((row) => ({
        destination_ref: (row as { destination_id?: string | null }).destination_id ?? null,
        product_name: row.product_name ?? '',
        size_label: row.size_label ?? null,
        qty: Number(row.quantity ?? 0),
      })),
      feesByRef: Object.fromEntries(rows.map((row) => [row.id, Number(row.split_fee ?? 0)])),
    })
  }

  const fulfilmentLabel = isSplitShipment
    ? `Split across ${destinationSummaries.length} delivery location${destinationSummaries.length === 1 ? '' : 's'}`
    : 'Single delivery'

  const shippingAddress = asAddress(order.quotes.shipping_address)

  return (
    <div className="min-h-screen bg-white">
      <SetTopBarContext value={{ kind: 'section', label: 'Order confirmation' }} />
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[var(--portal-topbar-h,76px)] md:px-6 md:pt-[120px]">
        <ConfirmationView
          orderId={order.id}
          orderRef={orderRef}
          status={order.status}
          awaitingApproval={awaitingApproval}
          mondaySynced={mondaySynced}
          isInventoryOrder={isInventoryOrder}
          isStockOnHandOrder={order.order_type === 'stock_on_hand'}
          customerEmail={context.email}
          shippingAddress={shippingAddress}
          destinations={destinationSummaries.map((summary) => ({
            ref: summary.ref,
            label: summary.label,
            unitTotal: summary.unitTotal,
            addressLines: formatSnapshotAddress(destinationAddressByRef[summary.ref] ?? null),
            lines: summary.lines.map((line) => ({
              productName: line.productName,
              sizeLabel: line.sizeLabel,
              qty: line.qty,
            })),
          }))}
          fulfilmentLabel={fulfilmentLabel}
          requiredBy={order.quotes.required_by}
          lines={lines}
          subtotalExGst={billedExGst}
          decorationCost={decorationCost}
          pickingFee={pickingFee}
          prepaidGoodsValue={prepaidGoodsValue}
          gst={gst}
          totalIncGst={totalIncGst}
          gstRate={gstRate}
          currency={currency}
          taxLabel={taxLabel}
          countryName={countryName}
        />
      </div>
    </div>
  )
}
