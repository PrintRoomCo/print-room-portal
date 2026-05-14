import type { SupabaseClient } from '@supabase/supabase-js'
import type { B2BCustomerContext } from '@/lib/checkout/server'
import { effectiveDecorationPrice } from '@/lib/checkout/decoration-effective-price'
import { sendOrderConfirmation } from '@/lib/email/order-confirmation'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import { getEffectiveMoq } from '@/lib/shop/effective-moq'
import { autofillProofForOrder } from '@/lib/proofs/autofill-for-order'

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
  /** Slice 4: 'inventory' routes the order into the org's stock shelf; 'customer' (default) is the existing delivery path. */
  intent?: 'customer' | 'inventory'
}

export interface CheckoutResult {
  order_id: string
  order_ref: string
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

export interface AccessDrift {
  cartLineId: string | null
  productId: string
  productName: string
}

export class MemberAccessDriftError extends Error {
  readonly drift: AccessDrift[]
  constructor(drift: AccessDrift[]) {
    super('member_access_drift')
    this.name = 'MemberAccessDriftError'
    this.drift = drift
  }
}

export interface StockShortfallDetail {
  code: 'insufficient_stock' | 'no_inventory'
  product_id: string | null
  variant_id: string | null
  available?: number
  requested?: number
}

export class StockShortfallError extends Error {
  readonly detail: StockShortfallDetail
  constructor(detail: StockShortfallDetail) {
    super(detail.code)
    this.name = 'StockShortfallError'
    this.detail = detail
  }
}

export interface MoqViolation {
  cartLineId: string | null
  productId: string
  productName: string
  effectiveMoq: number
  totalQty: number
}

export class MoqViolationError extends Error {
  readonly violations: MoqViolation[]
  constructor(violations: MoqViolation[]) {
    super('moq_violation')
    this.name = 'MoqViolationError'
    this.violations = violations
  }
}

export class BuyerScopeError extends Error {
  readonly mismatchedStoreIds: Array<string | null>
  readonly defaultStoreId: string | null
  constructor(mismatchedStoreIds: Array<string | null>, defaultStoreId: string | null) {
    super('buyer_ship_to_mismatch')
    this.name = 'BuyerScopeError'
    this.mismatchedStoreIds = mismatchedStoreIds
    this.defaultStoreId = defaultStoreId
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

interface QuoteRowForEmail {
  customer_name: string
  total_amount: number
  required_by: string | null
  payment_terms: string | null
}

interface QuoteItemForEmail {
  product_name: string
  quantity: number
  unit_price: number
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
  // 0. Buyer-scope guard: a buyer (Buyer Roles step 6) is locked to their
  //    defaultStoreId. Reject any line that ships elsewhere AND any custom-
  //    shipping path. Server-side mirror of CheckoutClient's ShipToRow lock.
  if (input.context.role === 'buyer') {
    const expected = input.context.defaultStoreId
    if (input.custom_shipping_address) {
      throw new BuyerScopeError([null], expected)
    }
    const mismatched = input.lines
      .map((l) => l.ship_to_store_id ?? null)
      .filter((sid) => sid !== expected)
    if (mismatched.length > 0) {
      throw new BuyerScopeError(mismatched, expected)
    }
  }

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

  // 1b. Per-member access re-verify. Mid-flight: if staff revoked a catalogue
  //     or item grant between cart load and checkout, we MUST reject before
  //     submit_b2b_order touches anything.
  const grantedItemIds = new Set(
    await getGrantedCatalogueItemIds(
      admin,
      input.context.membershipId,
      input.context.organizationId,
    ),
  )
  if (grantedItemIds.size > 0) {
    // Map each line.product_id to a catalogue_item the member can still see.
    // submit_b2b_order keys on product_id (matching /shop/[productId]), so it's
    // enough to confirm at least one granted catalogue item exists for the product.
    const productIds = Array.from(new Set(input.lines.map((l) => l.product_id)))
    const { data: visibleItems } = await admin
      .from('b2b_catalogue_items')
      .select('source_product_id')
      .in('source_product_id', productIds)
      .in('id', Array.from(grantedItemIds))
    const visibleProductIds = new Set(
      ((visibleItems ?? []) as Array<{ source_product_id: string }>).map(
        (r) => r.source_product_id,
      ),
    )
    const accessDrift: AccessDrift[] = []
    for (const line of input.lines) {
      if (!visibleProductIds.has(line.product_id)) {
        accessDrift.push({
          cartLineId: line.cart_line_id ?? null,
          productId: line.product_id,
          productName: line.product_name,
        })
      }
    }
    if (accessDrift.length > 0) throw new MemberAccessDriftError(accessDrift)
  } else {
    // No grants at all — every line is unavailable.
    throw new MemberAccessDriftError(
      input.lines.map((line) => ({
        cartLineId: line.cart_line_id ?? null,
        productId: line.product_id,
        productName: line.product_name,
      })),
    )
  }

  // 1c. MOQ guard. Resolves effective MOQ server-side from a fresh join of
  //     products + b2b_catalogue_items (within the customer's granted item
  //     set) — the client's payload doesn't carry MOQ and is not trusted
  //     here either. MOQ is per-product, summed across every line that
  //     shares productId (mirrors the PDP multi-size rule).
  const productIds = Array.from(new Set(input.lines.map((l) => l.product_id)))

  // Total qty per product across all lines — shared by MOQ enforcement (below)
  // and per-product re-pricing (further down). Multi-size orders are one print
  // run; pricing tier sums across sizes.
  const totalQtyByProductId = new Map<string, number>()
  for (const line of input.lines) {
    totalQtyByProductId.set(
      line.product_id,
      (totalQtyByProductId.get(line.product_id) ?? 0) + line.qty,
    )
  }

  const [{ data: productMoqRows }, { data: catItemMoqRows }] = await Promise.all([
    admin
      .from('products')
      .select('id, moq')
      .in('id', productIds),
    admin
      .from('b2b_catalogue_items')
      .select('source_product_id, moq_override')
      .in('source_product_id', productIds)
      .in('id', Array.from(grantedItemIds)),
  ])
  const productMoqById = new Map(
    ((productMoqRows ?? []) as Array<{ id: string; moq: number | null }>).map(
      (r) => [r.id, r.moq],
    ),
  )
  const overrideByProductId = new Map(
    ((catItemMoqRows ?? []) as Array<{
      source_product_id: string
      moq_override: number | null
    }>).map((r) => [r.source_product_id, r.moq_override]),
  )
  const moqViolations: MoqViolation[] = []
  // Report a violation per offending line (not per product) so the cart UI
  // can highlight every row affected, consistent with DecorationDriftError.
  for (const line of input.lines) {
    const effectiveMoq = getEffectiveMoq(
      { moq: productMoqById.get(line.product_id) ?? null },
      overrideByProductId.has(line.product_id)
        ? { moq_override: overrideByProductId.get(line.product_id) ?? null }
        : null,
      { orgMoqExempt: input.context.moqExempt },
    )
    const totalQty = totalQtyByProductId.get(line.product_id) ?? line.qty
    if (effectiveMoq > 1 && totalQty < effectiveMoq) {
      moqViolations.push({
        cartLineId: line.cart_line_id ?? null,
        productId: line.product_id,
        productName: line.product_name,
        effectiveMoq,
        totalQty,
      })
    }
  }
  if (moqViolations.length > 0) throw new MoqViolationError(moqViolations)

  // 2. Re-price every line on the server — ignore any client-sent prices.
  // Uses effective_unit_price so catalogue-scoped orgs get catalogue prices
  // (consistent with /shop), falling back to get_unit_price for global B2B.
  //
  // Pricing tier is summed by product_id so multi-size orders price at the
  // total run (mirrors the PDP: qty = multiSizeTotalQty | variantlessTotalQty).
  // Without this, 6S + 6M + 6L + 6XL = 24 each line would price at the 6-tier
  // instead of the 24-tier. Same fix path as the decoration totalQtyByLinkId
  // pattern below.
  const priceByProductId = new Map<string, number>()
  await Promise.all(
    Array.from(totalQtyByProductId.entries()).map(async ([productId, totalQty]) => {
      const { data: unit } = await admin.rpc('effective_unit_price', {
        p_product_id: productId,
        p_org_id: input.context.organizationId,
        p_qty: totalQty,
      })
      priceByProductId.set(productId, Number(unit ?? 0))
    }),
  )

  const repriced = input.lines.map(l => ({
    ...l,
    unit_price: priceByProductId.get(l.product_id) ?? 0,
  }))

  // 2b. Re-validate every selected decoration on every line. Server-side
  //     read of the link table + org_decoration; reject on cross-org reuse,
  //     unattached link, inactive decoration, mismatched catalogue item, or
  //     price drift greater than zero (per Decision #3 — no tolerance, AM
  //     edits are explicit). Validated decorations get persisted onto the
  //     order line as a jsonb snapshot below in step 4.
  //
  //     Multi-size parity: screenprint setup is amortised across the whole
  //     print run, so the PDP prices a decoration at the SUM of qtys across
  //     every size that selected it (multiSizeTotalQty). We mirror that here
  //     by pricing each decoration at the total qty across all lines that
  //     share its linkId — pricing per-line.qty would drift on multi-size.
  const totalQtyByLinkId = new Map<string, number>()
  for (const line of input.lines) {
    for (const dec of line.decorations ?? []) {
      totalQtyByLinkId.set(
        dec.linkId,
        (totalQtyByLinkId.get(dec.linkId) ?? 0) + line.qty,
      )
    }
  }

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
      const decorationQty = totalQtyByLinkId.get(dec.linkId) ?? line.qty
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
        decorationQty,
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

  // 3. Call the shared submit_b2b_order RPC. We fold the per-unit decoration
  //    cost into unit_price so the stored subtotal / total_amount / Monday
  //    subitems / order-confirmation email all match what the cart UI showed
  //    (cart's PriceBreakdown rolls decoration into the per-unit line).
  //    Without this, the quote would store garment-only and we'd under-bill
  //    the customer for the decoration they ordered.
  const decorationCostByLineKey = new Map<string, number>()
  let totalDecorationRevenue = 0
  for (const l of repriced) {
    const validated =
      validatedByLineKey.get(makeLineKey(l.product_id, l.variant_id ?? null)) ?? []
    const perUnit = validated.reduce((s, d) => s + d.unitPrice, 0)
    decorationCostByLineKey.set(makeLineKey(l.product_id, l.variant_id ?? null), perUnit)
    totalDecorationRevenue += perUnit * l.qty
  }

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
    p_lines: repriced.map((l) => {
      const perUnitDeco =
        decorationCostByLineKey.get(makeLineKey(l.product_id, l.variant_id ?? null)) ?? 0
      return {
        product_id: l.product_id,
        product_name: l.product_name,
        quantity: l.qty,
        unit_price: l.unit_price + perUnitDeco,
        variant_id: l.variant_id ?? null,
      }
    }),
    p_intent: input.intent ?? 'customer',
  })
  if (error) {
    if (error.message === 'INSUFFICIENT_STOCK' || error.message === 'NO_INVENTORY') {
      let parsed: Partial<StockShortfallDetail> = {}
      try {
        parsed = JSON.parse((error as { details?: string | null }).details ?? '{}')
      } catch {
        // fall through with empty detail
      }
      throw new StockShortfallError({
        code: error.message === 'INSUFFICIENT_STOCK' ? 'insufficient_stock' : 'no_inventory',
        product_id: parsed.product_id ?? null,
        variant_id: parsed.variant_id ?? null,
        available: parsed.available,
        requested: parsed.requested,
      })
    }
    throw new Error(error.message)
  }

  const rowRaw = Array.isArray(data) ? data[0] : data
  const row = rowRaw as SubmitB2BOrderRow | null
  if (!row) throw new Error('submit_b2b_order returned no row')
  const { quote_id, order_id, order_ref } = row

  // Record decoration revenue separately on the quote so finance can split
  // garment vs decoration without parsing quote_items.decorations jsonb.
  // total_amount already includes decoration via the folded unit_price above.
  if (totalDecorationRevenue > 0) {
    await admin
      .from('quotes')
      .update({ decoration_cost: totalDecorationRevenue })
      .eq('id', quote_id)
  }

  await recordAuditEvent(
    {
      orgId: input.context.organizationId,
      actorUserId: input.context.userId,
      action: AUDIT_ACTIONS.ORDER_SUBMIT,
      targetType: 'order',
      targetId: order_id,
      metadata: {
        order_ref,
        quote_id,
        line_count: input.lines.length,
        total_qty: input.lines.reduce((acc, l) => acc + l.qty, 0),
        idempotency_key: input.idempotency_key,
      },
    },
    admin,
  )

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

  // 5. Hold the order for AM approval. Monday push is no longer fired here —
  //    moved to the staff approve route so an account manager confirms pricing
  //    + decoration before production starts. RPC hardcodes 'awaiting-production'
  //    in its insert (shared with legacy callers); we flip it to 'awaiting-approval'
  //    immediately after.
  await admin
    .from('orders')
    .update({ status: 'awaiting-approval' })
    .eq('id', order_id)

  // 5b. F1 (spec 2026-05-13 §G.4) — best-effort proof shell so staff dashboards
  //     populate with customer-originated drafts the same way they do for staff-
  //     originated B2B submits. Pulls org/customer/order_ref from the quote
  //     because `orders` itself carries none of those signals (schema reality
  //     check — see §F.1). The helper never throws; failure paths collapse to
  //     an audit_events row so the order submit always succeeds.
  try {
    const { data: quote } = await admin
      .from('quotes')
      .select('id, organization_id, customer_name, customer_email, order_ref')
      .eq('id', quote_id)
      .single<{
        id: string
        organization_id: string | null
        customer_name: string | null
        customer_email: string | null
        order_ref: string | null
      }>()
    const { data: lineRows } = await admin
      .from('quote_items')
      .select('product_id')
      .eq('quote_id', quote_id)
    const productIds = ((lineRows ?? []) as Array<{ product_id: string | null }>)
      .map((r) => r.product_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (quote?.organization_id && quote.order_ref) {
      await autofillProofForOrder(
        {
          orderId: order_id,
          quoteId: quote_id,
          organizationId: quote.organization_id,
          customerName: quote.customer_name ?? input.context.organizationName,
          customerEmail: quote.customer_email ?? input.context.email ?? '',
          orderRef: quote.order_ref,
          productIds,
        },
        admin,
      )
    }
  } catch (e) {
    // Defence-in-depth — the helper is contracted never to throw, but a
    // failure here must NEVER bubble out of submit and break the order.
    console.error('[Checkout] autofillProofForOrder threw (swallowed)', {
      orderId: order_id,
      err: e instanceof Error ? e.message : String(e),
    })
  }

  // Fetch the email payload from quotes/quote_items for the confirmation email below.
  let emailLines: OrderConfirmationLine[] = []
  let emailTotalAmount: number | null = null
  let emailPaymentTerms: string | null = input.context.paymentTerms ?? PAYMENT_TERMS_FALLBACK
  let emailRequiredBy: string | null = input.required_by ?? null
  let emailCustomerName = input.context.organizationName
  try {
    const { data: q } = await admin
      .from('quotes')
      .select('customer_name, total_amount, required_by, payment_terms')
      .eq('id', quote_id)
      .single()
    const quote = q as QuoteRowForEmail | null
    if (quote) {
      emailTotalAmount = Number(quote.total_amount)
      emailPaymentTerms = quote.payment_terms ?? emailPaymentTerms
      emailRequiredBy = quote.required_by ?? emailRequiredBy
      emailCustomerName = quote.customer_name
    }

    const { data: lines } = await admin
      .from('quote_items')
      .select(
        `product_name, quantity, unit_price,
         product_variants (
           product_color_swatches (label),
           sizes (label)
         )`
      )
      .eq('quote_id', quote_id)
    const lineRows = (lines ?? []) as unknown as QuoteItemForEmail[]
    emailLines = lineRows.map((l) => {
      const swatch = pickOne(l.product_variants?.product_color_swatches ?? null)
      const size = pickOne(l.product_variants?.sizes ?? null)
      const variantLabel = [swatch?.label, size?.label].filter(Boolean).join(' / ') || '—'
      return {
        productName: l.product_name,
        variantLabel,
        quantity: l.quantity,
        unitPrice: Number(l.unit_price),
      }
    })
  } catch {
    // Email payload fetch failure shouldn't block the order; fall through to
    // the fallback shape built from `repriced` in step 6.
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
        orderId: order_id,
        orderRef: order_ref,
        totalAmount: fallbackTotal,
        paymentTerms: emailPaymentTerms,
        contractNotes: input.context.contractNotes,
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

  return { order_id, order_ref }
}
