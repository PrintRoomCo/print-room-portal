import type { SupabaseClient } from '@supabase/supabase-js'
import type { B2BCustomerContext } from '@/lib/checkout/server'
import { effectiveDecorationPrice } from '@/lib/checkout/decoration-effective-price'
import { sendOrderConfirmation } from '@/lib/email/order-confirmation'
import { pushProductionJob } from '@/lib/monday/production-job'
import { PRODUCTION_BOARD_ID } from '@/lib/monday/column-ids'

export interface CheckoutLineDecorationInput {
  linkId: string
  decorationId: string
  name: string
  method: string
  positionLabel: string | null
  unitPrice: number
  artworkUrl: string
  snapshotUrl: string | null
}

export interface CheckoutLineInput {
  product_id: string
  product_name: string
  variant_id?: string | null
  qty: number
  ship_to_store_id?: string | null
  decorations?: CheckoutLineDecorationInput[]
  /** Stable per-line id from the cart, used in error responses to point at the offending line. */
  cart_line_id?: string
}

export interface CheckoutInput {
  context: B2BCustomerContext
  idempotency_key: string
  required_by?: string | null
  notes?: string | null
  internal_notes?: string | null
  lines: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
}

export interface CheckoutResult {
  order_id: string
  order_ref: string
  monday_item_id: string | null
  monday_push_error: string | null
}

export interface DecorationDrift {
  cartLineId: string | null
  productId: string
  linkId: string
  decorationName: string
  was: number
  now: number
  reason: 'price_drift' | 'detached' | 'cross_org' | 'inactive' | 'wrong_item'
}

export class DecorationDriftError extends Error {
  readonly drift: DecorationDrift[]
  constructor(drift: DecorationDrift[]) {
    super('decoration_price_drift')
    this.name = 'DecorationDriftError'
    this.drift = drift
  }
}

interface SubmitB2BOrderRow {
  quote_id: string
  order_id: string
  order_ref: string
}

interface StoreRow {
  id: string
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
}

interface QuoteItemRow {
  id: string
  product_id: string
  variant_id: string | null
}

interface QuoteRowForMonday {
  order_ref: string
  customer_name: string
  customer_email: string | null
  total_amount: number
  required_by: string | null
  payment_terms: string | null
  notes: string | null
  monday_item_id: string | null
}

interface QuoteItemForMonday {
  id: string
  product_name: string
  quantity: number
  unit_price: number
  monday_subitem_id: string | null
  product_variants:
    | {
        product_color_swatches: { label: string | null } | { label: string | null }[] | null
        sizes: { label: string | null } | { label: string | null }[] | null
      }
    | null
}

interface OrderConfirmationLine {
  productName: string
  variantLabel: string
  quantity: number
  unitPrice: number
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function makeLineKey(productId: string, variantId: string | null): string {
  return `${productId}::${variantId ?? ''}`
}

// b2b_accounts.payment_terms CHECK constraint allows only 'prepay' | 'net20' | 'net30'.
// Plan default was 'net_20' which fails; use 'net20' instead.
const PAYMENT_TERMS_FALLBACK = 'net20'

export async function submitCustomerOrder(
  admin: SupabaseClient,
  input: CheckoutInput
): Promise<CheckoutResult> {
  // 1. Resolve shipping_address — either the custom JSON or the first line's store.
  let shippingAddress: Record<string, unknown> = input.custom_shipping_address ?? {}
  if (!input.custom_shipping_address && input.lines[0]?.ship_to_store_id) {
    const { data: firstStore } = await admin
      .from('stores')
      .select('id, name, address, city, state, country, postal_code')
      .eq('id', input.lines[0].ship_to_store_id)
      .single()
    if (firstStore) shippingAddress = firstStore as unknown as Record<string, unknown>
  }

  // 2. Re-price every line on the server — ignore any client-sent prices.
  // Uses effective_unit_price so catalogue-scoped orgs get catalogue prices
  // (consistent with /shop), falling back to get_unit_price for global B2B.
  const repriced = await Promise.all(
    input.lines.map(async (l) => {
      const { data: unit } = await admin.rpc('effective_unit_price', {
        p_product_id: l.product_id,
        p_org_id: input.context.organizationId,
        p_qty: l.qty,
      })
      return { ...l, unit_price: Number(unit ?? 0) }
    })
  )

  // 2b. Re-validate every selected decoration on every line. Server-side
  //     read of the link table + org_decoration; reject on cross-org reuse,
  //     unattached link, inactive decoration, mismatched catalogue item, or
  //     price drift greater than zero (per Decision #3 — no tolerance, AM
  //     edits are explicit). Validated decorations get persisted onto the
  //     order line as a jsonb snapshot below in step 4.
  const validatedByLineKey = new Map<string, CheckoutLineDecorationInput[]>()
  const drift: DecorationDrift[] = []

  for (const line of input.lines) {
    const decs = line.decorations ?? []
    if (decs.length === 0) {
      validatedByLineKey.set(makeLineKey(line.product_id, line.variant_id ?? null), [])
      continue
    }
    const linkIds = decs.map((d) => d.linkId)
    const { data: rows, error: linkErr } = await admin
      .from('b2b_catalogue_item_decorations')
      .select(`
        id,
        catalogue_item_id,
        unit_price_override,
        snapshot_url,
        b2b_catalogue_items!inner(id, source_product_id),
        org_decorations!inner(
          id,
          organization_id,
          name,
          decoration_method,
          unit_price,
          is_active,
          width_mm,
          height_mm,
          colour_count,
          organization_artworks!org_decorations_artwork_id_fkey(public_url),
          decoration_locations!org_decorations_decoration_location_id_fkey(location, placement_key)
        )
      `)
      .in('id', linkIds)
    if (linkErr) {
      throw new Error(`decoration lookup failed: ${linkErr.message}`)
    }

    type LinkRow = {
      id: string
      catalogue_item_id: string
      unit_price_override: number | string | null
      snapshot_url: string | null
      b2b_catalogue_items: { id: string; source_product_id: string }
      org_decorations: {
        id: string
        organization_id: string
        name: string
        decoration_method: string
        unit_price: number | string
        is_active: boolean
        width_mm: number | null
        height_mm: number | null
        colour_count: number | null
        organization_artworks: { public_url: string } | { public_url: string }[] | null
        decoration_locations:
          | { location: string; placement_key: string | null }
          | { location: string; placement_key: string | null }[]
          | null
      }
    }

    const byId = new Map((rows as unknown as LinkRow[] ?? []).map((r) => [r.id, r]))
    const validated: CheckoutLineDecorationInput[] = []

    for (const dec of decs) {
      const row = byId.get(dec.linkId)
      if (!row) {
        drift.push({
          cartLineId: line.cart_line_id ?? null,
          productId: line.product_id,
          linkId: dec.linkId,
          decorationName: dec.name,
          was: dec.unitPrice,
          now: 0,
          reason: 'detached',
        })
        continue
      }
      const od = row.org_decorations
      if (od.organization_id !== input.context.organizationId) {
        drift.push({
          cartLineId: line.cart_line_id ?? null,
          productId: line.product_id,
          linkId: dec.linkId,
          decorationName: od.name,
          was: dec.unitPrice,
          now: Number(od.unit_price),
          reason: 'cross_org',
        })
        continue
      }
      if (!od.is_active) {
        drift.push({
          cartLineId: line.cart_line_id ?? null,
          productId: line.product_id,
          linkId: dec.linkId,
          decorationName: od.name,
          was: dec.unitPrice,
          now: Number(od.unit_price),
          reason: 'inactive',
        })
        continue
      }
      if (row.b2b_catalogue_items.source_product_id !== line.product_id) {
        drift.push({
          cartLineId: line.cart_line_id ?? null,
          productId: line.product_id,
          linkId: dec.linkId,
          decorationName: od.name,
          was: dec.unitPrice,
          now: Number(od.unit_price),
          reason: 'wrong_item',
        })
        continue
      }
      const loc = pickOne(od.decoration_locations)
      const effective = await effectiveDecorationPrice(
        admin,
        {
          decorationMethod: od.decoration_method,
          unitPriceOverride: row.unit_price_override,
          baseUnitPrice: od.unit_price,
          widthMm: od.width_mm,
          heightMm: od.height_mm,
          colourCount: od.colour_count,
          placementKey: loc?.placement_key ?? null,
        },
        line.qty,
      )
      if (effective !== dec.unitPrice) {
        drift.push({
          cartLineId: line.cart_line_id ?? null,
          productId: line.product_id,
          linkId: dec.linkId,
          decorationName: od.name,
          was: dec.unitPrice,
          now: effective,
          reason: 'price_drift',
        })
        continue
      }
      const art = pickOne(od.organization_artworks)
      validated.push({
        linkId: row.id,
        decorationId: od.id,
        name: od.name,
        method: od.decoration_method,
        positionLabel: loc?.location ?? null,
        unitPrice: effective,
        artworkUrl: art?.public_url ?? dec.artworkUrl,
        snapshotUrl: row.snapshot_url,
      })
    }
    validatedByLineKey.set(makeLineKey(line.product_id, line.variant_id ?? null), validated)
  }

  if (drift.length > 0) {
    throw new DecorationDriftError(drift)
  }

  // 3. Call the shared submit_b2b_order RPC.
  const { data, error } = await admin.rpc('submit_b2b_order', {
    p_idempotency_key: input.idempotency_key,
    p_organization_id: input.context.organizationId,
    p_customer_code: input.context.customerCode!,
    p_customer_name: input.context.organizationName,
    p_customer_email: input.context.email,
    p_customer_phone: null,
    p_shipping_address: shippingAddress,
    p_payment_terms: input.context.paymentTerms ?? PAYMENT_TERMS_FALLBACK,
    p_required_by: input.required_by ?? null,
    p_notes: input.notes ?? null,
    p_internal_notes: input.internal_notes ?? null,
    p_lines: repriced.map((l) => ({
      product_id: l.product_id,
      product_name: l.product_name,
      quantity: l.qty,
      unit_price: l.unit_price,
      variant_id: l.variant_id ?? null,
    })),
  })
  if (error) throw new Error(error.message)

  const rowRaw = Array.isArray(data) ? data[0] : data
  const row = rowRaw as SubmitB2BOrderRow | null
  if (!row) throw new Error('submit_b2b_order returned no row')
  const { quote_id, order_id, order_ref } = row

  // 4. Apply per-line ship_to_store_id and the decorations snapshot. The RPC
  //    creates quote_items without ship-to or decorations; we set both here.
  const { data: newLines } = await admin
    .from('quote_items')
    .select('id, product_id, variant_id')
    .eq('quote_id', quote_id)
  if (newLines) {
    const rows = newLines as QuoteItemRow[]
    for (const inLine of input.lines) {
      const match = rows.find(
        (x) =>
          x.product_id === inLine.product_id &&
          (x.variant_id ?? null) === (inLine.variant_id ?? null)
      )
      if (!match) continue
      const update: Record<string, unknown> = {}
      if (inLine.ship_to_store_id !== undefined) {
        update.ship_to_store_id = inLine.ship_to_store_id ?? null
      }
      const validated =
        validatedByLineKey.get(makeLineKey(inLine.product_id, inLine.variant_id ?? null)) ?? []
      update.decorations = validated
      if (Object.keys(update).length > 0) {
        await admin.from('quote_items').update(update).eq('id', match.id)
      }
    }
  }

  // 5. Monday push. Failure here doesn't roll back the order — staff can
  //    reconcile via the staff portal. monday_push_error surfaces on the
  //    confirmation page so the customer knows not to panic.
  let monday_item_id: string | null = null
  let monday_push_error: string | null = null
  let emailLines: OrderConfirmationLine[] = []
  let emailTotalAmount: number | null = null
  let emailPaymentTerms: string | null = input.context.paymentTerms ?? PAYMENT_TERMS_FALLBACK
  let emailRequiredBy: string | null = input.required_by ?? null
  let emailCustomerName = input.context.organizationName
  try {
    const { data: q } = await admin
      .from('quotes')
      .select(
        'order_ref, customer_name, customer_email, total_amount, required_by, payment_terms, notes, monday_item_id'
      )
      .eq('id', quote_id)
      .single()
    const quote = q as QuoteRowForMonday | null
    if (!quote) throw new Error('quote row missing after submit_b2b_order')
    emailTotalAmount = Number(quote.total_amount)
    emailPaymentTerms = quote.payment_terms ?? emailPaymentTerms
    emailRequiredBy = quote.required_by ?? emailRequiredBy
    emailCustomerName = quote.customer_name

    const { data: lines } = await admin
      .from('quote_items')
      .select(
        `id, product_name, quantity, unit_price, monday_subitem_id,
         product_variants (
           product_color_swatches (label),
           sizes (label)
         )`
      )
      .eq('quote_id', quote_id)
    const lineRows = (lines ?? []) as unknown as QuoteItemForMonday[]

    const order = {
      order_ref: quote.order_ref,
      customer_name: quote.customer_name,
      customer_email: quote.customer_email,
      total_price: Number(quote.total_amount),
      required_by: quote.required_by,
      payment_terms: quote.payment_terms,
      notes: quote.notes,
      monday_item_id: quote.monday_item_id,
    }
    const pLines = lineRows.map((l) => {
      const swatch = pickOne(l.product_variants?.product_color_swatches ?? null)
      const size = pickOne(l.product_variants?.sizes ?? null)
      const variantLabel = [swatch?.label, size?.label].filter(Boolean).join(' / ') || '—'
      return {
        quote_item_id: l.id,
        product_name: l.product_name,
        variant_label: variantLabel,
        quantity: l.quantity,
        unit_price: Number(l.unit_price),
        decoration_summary: null,
        existing_subitem_id: l.monday_subitem_id,
      }
    })
    emailLines = pLines.map((line) => ({
      productName: line.product_name,
      variantLabel: line.variant_label,
      quantity: line.quantity,
      unitPrice: line.unit_price,
    }))

    const result = await pushProductionJob(order, pLines)
    monday_item_id = result.itemId
    await admin
      .from('quotes')
      .update({
        monday_item_id: result.itemId,
        monday_board_id: String(PRODUCTION_BOARD_ID),
      })
      .eq('id', quote_id)
    for (const [qItemId, subitemId] of Object.entries(result.subitemIds)) {
      await admin.from('quote_items').update({ monday_subitem_id: subitemId }).eq('id', qItemId)
    }
  } catch (e) {
    monday_push_error = (e as Error).message
  }

  // 6. Order-confirmation email. Failure here must not roll back the order or
  //    depend on the Monday push result.
  try {
    if (input.context.email) {
      const fallbackLines =
        emailLines.length > 0
          ? emailLines
          : repriced.map((line) => ({
              productName: line.product_name,
              variantLabel: '-',
              quantity: line.qty,
              unitPrice: line.unit_price,
            }))
      const fallbackTotal =
        emailTotalAmount ??
        repriced.reduce((total, line) => total + line.unit_price * line.qty, 0)

      const result = await sendOrderConfirmation({
        to: input.context.email,
        customerName: emailCustomerName,
        orderRef: order_ref,
        totalAmount: fallbackTotal,
        paymentTerms: emailPaymentTerms,
        requiredBy: emailRequiredBy,
        lines: fallbackLines,
      })
      if (!result.success) {
        console.error(
          '[Checkout] Order-confirmation email failed:',
          result.error ?? 'Unknown error'
        )
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[Checkout] Order-confirmation email failed:', message)
  }

  return { order_id, order_ref, monday_item_id, monday_push_error }
}
