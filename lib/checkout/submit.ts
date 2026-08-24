import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { B2BCustomerContext } from '@/lib/checkout/server'
import { sendOrderConfirmation } from '@/lib/email/order-confirmation'
import { resolveOrderEmailRecipient } from './order-email-recipient'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { routeForFulfilmentType } from '@/lib/shop/fulfilment-mode'
import { autofillProofForOrder } from '@/lib/proofs/autofill-for-order'
import { pushOrderDeal, type OrderLineForMonday } from '@/lib/monday/deal-item'
import { PRODUCTION_BOARD_ID } from '@/lib/monday/column-ids'
import { createJobTrackerShellForOrder } from '@/lib/orders/job-tracker'
import { createDraftInvoiceForOrder } from '@/lib/xero/draft-invoice'
import { xeroRegionForBillCountry } from '@/lib/xero/config'
import { pushOrderToStarshipit } from '@/lib/starshipit/push-order'
import { isStarshipitEnabled } from '@/lib/starshipit/config'
import { postItemUpdate } from '@/lib/monday/updates'
import { orderBillingNote } from '@/lib/monday/billing-note'
import { currencyForRegion } from '@/lib/pricing/gst'
import { round2 } from '@/lib/pricing/pricingMath'
import { billedFigures } from '@/lib/checkout/billed-figures'
import type { BillingMode } from '@/lib/shop/billing-mode'
import { postOrderPlacedSlack } from '@/lib/notifications/slack-order-placed'
import { sendOrderPlacedDispatch } from '@/lib/email/order-placed-dispatch'
import { staffOrderUrl } from '@/lib/config/staff-portal-url'
import {
  resolveDispatchNotificationRecipient,
  isTestOrgFailClosed,
} from '@/lib/checkout/dispatch-notification-recipient'
import {
  prepareCustomerOrderPartition,
  preparedCheckoutInternalsFor,
  type PrepareCustomerOrderOptions,
} from '@/lib/checkout/prepare'

export {
  billedOrderTotal,
  buildBillingModeDrift,
  garmentUnitPriceForLine,
  tierAggregationKey,
} from '@/lib/checkout/prepare'
export type { BilledTotalLine } from '@/lib/checkout/prepare'
import {
  BillingModeDriftError,
  BuyerScopeError,
  DecorationDriftError,
  DisabledCountryError,
  MemberAccessDriftError,
  MixedShippingAddressError,
  MoqViolationError,
  StockShortfallError,
  UnitPriceDriftError,
  type AccessDrift,
  type BillingModeDrift,
  type DecorationDrift,
  type MoqViolation,
  type StockShortfallDetail,
  type UnitPriceDrift,
} from '@/lib/checkout/errors'

export {
  BillingModeDriftError,
  BuyerScopeError,
  DecorationDriftError,
  DisabledCountryError,
  MemberAccessDriftError,
  MixedShippingAddressError,
  MoqViolationError,
  StockShortfallError,
  UnitPriceDriftError,
}
export type {
  AccessDrift,
  BillingModeDrift,
  DecorationDrift,
  MoqViolation,
  StockShortfallDetail,
  UnitPriceDrift,
}

export interface CheckoutLineDecorationInput {
  linkId: string
  decorationId: string
  name: string
  method: string
  positionLabel: string | null
  unitPrice: number
  artworkUrl: string | null
  snapshotUrl: string | null
}

export interface CheckoutLineInput {
  product_id: string
  product_name: string
  variant_id?: string | null
  /** SKUCOLLAPSE: size chosen at order time (colourway model). */
  size_id?: number | null
  size_label?: string | null
  qty: number
  ship_to_store_id?: string | null
  decorations?: CheckoutLineDecorationInput[]
  /** Stable per-line id from the cart, used in error responses to point at the offending line. */
  cart_line_id?: string
  /**
   * Cart's claimed bare-product unit price at submit-time. Set when the cart
   * had a brackets snapshot (B.2/B.3); the server compares against the
   * canonical tier price and throws UnitPriceDriftError on mismatch. Absent
   * for legacy carts — server silently uses its canonical price (current
   * pre-2026-05-15 behaviour).
   */
  claimed_unit_price?: number
  /** Currency of the cart-drawer snapshot; a different destination currency is repriced at review. */
  priceCurrency?: string
  /** Destination-currency values last reviewed by the customer. */
  reviewed_unit_price?: number
  reviewed_decoration_price?: number
  reviewed_currency?: string
  /** True iff the cart carried a brackets snapshot for this line. */
  has_brackets?: boolean
  /**
   * Per-line fulfilment from the PDP order-mode toggle. 'stocked' lines draw
   * down existing inventory and are exempt from MOQ — the stock is already
   * made. Absent on legacy carts; treated as MOQ-applicable (conservative).
   */
  fulfilment_type?: 'stocked' | 'made_to_order'
  /**
   * Phase 2 — catalogue-item identity carried from the cart line. Threaded into
   * submit_b2b_order_for_country's p_lines so the order records which skin sold. camelCase
   * to match the cart line; the RPC payload maps it to snake_case
   * catalogue_item_id. Null/absent for legacy/non-catalogue lines.
   */
  catalogueItemId?: string | null
  /**
   * Manual-final pricing (2026-06-10). The cart's claimed combined decoration
   * figure for the whole item (one number per band). Present only for lines on a
   * price_mode='manual_final' catalogue item. The server re-derives the figure
   * from catalogue_item_decoration_price() and drift-checks against this with
   * zero tolerance, then folds the SERVER value (never the per-placement sum)
   * into the line's unit price. Null/absent for computed lines (today's path).
   */
  claimed_manual_decoration?: number | null
  /**
   * The cart's claimed per-variant billing class at submit time (spec 2026-07-17
   * D4). The server re-resolves from variant_inventory and throws
   * BillingModeDriftError on ANY mismatch, in BOTH directions — even drift that
   * favours the customer means checkout disagreed with the quote, which is the
   * defect this guard exists for. Absent for legacy carts, which skip the guard
   * (mirrors the has_brackets gate on unit_price_drift).
   */
  claimed_billing_mode?: BillingMode | null
  /** Feature 1 — chosen PDP location dropdown label; snapshotted to quote_items. */
  location_label?: string | null
  /** Feature 2 — optional PDP custom name; snapshotted to quote_items.line_custom_name. */
  custom_name?: string | null
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
  /**
   * F1 mixed-cart split: when the checkout route partitions one cart into two
   * submit calls, tier/garment price pooling would otherwise see only this
   * partition's qty and re-derive a HIGHER tier price than the cart claimed
   * (drift 409, or silent overcharge on legacy lines). Pass the FULL cart here
   * — it seeds ONLY the qty-pooling aggregations; the submitted/validated
   * lines are still `lines`. Defaults to `lines` (single-order path unchanged).
   */
  pricing_pool_lines?: CheckoutLineInput[]
  /**
   * Design 2026-08-11: the buyer's affirmative T&C acceptance for THIS order.
   * Validated at the route (400 unless accepted === true AND a non-empty
   * version). Recorded post-commit as a TERMS_ACCEPTED audit event and folded
   * into ORDER_SUBMIT metadata — best-effort, like every post-commit side-effect
   * here. The route is the legal gate; these writes are the queryable trail.
   * By design this function never re-reads terms_accepted (the route already
   * proved it true); only terms_version is consumed, for the audit trail.
   */
  terms_accepted?: boolean
  terms_version?: string
}

export interface CheckoutResult {
  order_id: string
  order_ref: string
}

export interface RegionQuotaDetails {
  store_id: string
  catalogue_item_id: string
  region_quota: number
  already_ordered: number
  requested: number
  remaining: number
}

export class RegionQuotaError extends Error {
  details: RegionQuotaDetails
  constructor(details: RegionQuotaDetails) {
    super('REGION_QUOTA_EXCEEDED')
    this.name = 'RegionQuotaError'
    this.details = details
  }
}

/** Maps a Supabase RPC error to RegionQuotaError, or null if it isn't one. */
export function parseRegionQuotaError(
  error: { message?: string | null; details?: string | null } | null,
): RegionQuotaError | null {
  if (!error || error.message !== 'REGION_QUOTA_EXCEEDED') return null
  try {
    const d = JSON.parse(error.details ?? '{}') as Partial<RegionQuotaDetails>
    return new RegionQuotaError({
      store_id: String(d.store_id ?? ''),
      catalogue_item_id: String(d.catalogue_item_id ?? ''),
      region_quota: Number(d.region_quota ?? 0),
      already_ordered: Number(d.already_ordered ?? 0),
      requested: Number(d.requested ?? 0),
      remaining: Number(d.remaining ?? 0),
    })
  } catch {
    return new RegionQuotaError({
      store_id: '', catalogue_item_id: '', region_quota: 0,
      already_ordered: 0, requested: 0, remaining: 0,
    })
  }
}

interface SubmitB2BOrderRow {
  quote_id: string
  order_id: string
  order_ref: string
}

interface QuoteItemRow {
  id: string
  product_id: string
  variant_id: string | null
  size_id: number | null
  product_name: string
}

interface QuoteRowForEmail {
  customer_name: string
  total_amount: number
  picking_fee: number | null
  billed_total: number | null
  required_by: string | null
}

interface QuoteItemForEmail {
  product_name: string
  quantity: number
  unit_price: number
  size_label: string | null
  product_variants:
    | {
        product_color_swatches: { label: string | null } | { label: string | null }[] | null
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

// SKUCOLLAPSE: include size so two sizes of one colourway (same product_id +
// variant_id) don't collapse into one per-line map entry.
function makeLineKey(productId: string, variantId: string | null, sizeId: number | null = null): string {
  return `${productId}::${variantId ?? ''}::${sizeId ?? ''}`
}

/**
 * Build the post-RPC follow-up UPDATE for one order line's snapshot columns.
 * The RPC creates quote_items without ship-to / decorations / location; we set
 * them here (the country wrapper keeps the legacy line contract). Each field is only written when
 * the input line actually carried it (undefined → column left untouched), so a
 * legacy line never clobbers an existing value. `line_location_label` is the
 * feature-1 frozen label snapshot (Task 2 column).
 */
export function buildLineSnapshotUpdate(
  inLine: Pick<CheckoutLineInput, 'ship_to_store_id' | 'location_label' | 'custom_name'>,
  validatedDecorations: CheckoutLineDecorationInput[],
): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (inLine.ship_to_store_id !== undefined) update.ship_to_store_id = inLine.ship_to_store_id ?? null
  if (inLine.location_label !== undefined) update.line_location_label = inLine.location_label ?? null
  if (inLine.custom_name !== undefined) update.line_custom_name = inLine.custom_name ?? null
  update.decorations = validatedDecorations
  return update
}


// b2b_accounts.payment_terms CHECK constraint allows only 'prepay' | 'net20' | 'net30'.
// Plan default was 'net_20' which fails; use 'net20' instead.
const PAYMENT_TERMS_FALLBACK = 'net20'

export async function submitCustomerOrder(
  admin: SupabaseClient,
  input: CheckoutInput,
  options?: PrepareCustomerOrderOptions,
): Promise<CheckoutResult> {
  const preparationOptions: PrepareCustomerOrderOptions =
    options ?? {
      countryPartitionEnabled: false,
      partitionKey: 'legacy',
      country: {
        code: 'NZ',
        name: 'New Zealand',
        currency: 'NZD',
        taxRate: 0.15,
        taxLabel: 'GST 15%',
        isDefault: true,
      },
    }
  const prepared = await prepareCustomerOrderPartition(admin, input, preparationOptions)
  const {
    shipToStoreIds,
    shippingAddress,
    formattedShippingAddress,
    repriced,
    validatedByLineKey,
    decoCatalogueItemIdByLineKey,
    decorationCostByLineKey,
    totalDecorationRevenue,
    billingModeByVariant,
    orderType,
    needsInvoicing,
    orgRegion,
    pickFee,
    billedTotal,
    openPeriod,
    preOrderItemIds,
  } = preparedCheckoutInternalsFor(prepared)
  const isStockOnHandOrder = orderType === 'stock_on_hand'
  const billCountry = preparationOptions.countryPartitionEnabled
    ? prepared.country.code
    : orgRegion
  const billingCurrency = preparationOptions.countryPartitionEnabled
    ? prepared.country.currency
    : currencyForRegion(orgRegion)

  // Phase 2 — drift signal only (we never throw): if a line's own catalogue
  // identity disagrees with the one its decoration links resolve to, log once
  // and trust the line's id (it is the authoritative line identity).
  let warnedCatalogueDrift = false

  const { data, error } = await admin.rpc('submit_b2b_order_for_country', {
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
        decorationCostByLineKey.get(makeLineKey(l.product_id, l.variant_id ?? null, l.size_id ?? null)) ?? 0
      // Phase 2 — the line's own catalogueItemId is the authoritative identity.
      // The decoration-derived id is only a cross-check; if they disagree, warn
      // once and still trust the line's id.
      const lineCatalogueItemId = l.catalogueItemId ?? null
      const decoCatalogueItemId =
        decoCatalogueItemIdByLineKey.get(makeLineKey(l.product_id, l.variant_id ?? null, l.size_id ?? null)) ?? null
      if (
        lineCatalogueItemId &&
        decoCatalogueItemId &&
        lineCatalogueItemId !== decoCatalogueItemId &&
        !warnedCatalogueDrift
      ) {
        warnedCatalogueDrift = true
        console.warn(
          `[submit_b2b_order_for_country] catalogue_item_id drift on line ` +
            `${l.cart_line_id ?? l.product_id}: line carries ${lineCatalogueItemId} but ` +
            `its decoration links resolve to ${decoCatalogueItemId}; trusting the line id.`,
        )
      }
      return {
        product_id: l.product_id,
        product_name: l.product_name,
        quantity: l.qty,
        unit_price: l.unit_price + perUnitDeco,
        variant_id: l.variant_id ?? null,
        size_id: l.size_id ?? null,
        size_label: l.size_label ?? null,
        catalogue_item_id: lineCatalogueItemId,
        // DOC region-quota: the RPC reads this per line to enforce the per-store
        // cap. `repriced` spreads `...l`, so ship_to_store_id survives repricing.
        ship_to_store_id: l.ship_to_store_id ?? null,
        // The route the customer picked. Read AFTER the nature coercion above
        // (L751-760), so a line that claimed a stock draw on an item that does
        // not offer one arrives demoted rather than trusted.
        fulfilment_route: routeForFulfilmentType(l.fulfilment_type),
      }
    }),
    p_intent: input.intent ?? 'customer',
    p_member_permission: input.context.orderingPermission ?? 'both',
    p_bill_country: billCountry,
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
    const rq = parseRegionQuotaError(error)
    if (rq) throw rq
    throw new Error(error.message)
  }

  const rowRaw = Array.isArray(data) ? data[0] : data
  const row = rowRaw as SubmitB2BOrderRow | null
  if (!row) throw new Error('submit_b2b_order_for_country returned no row')
  const { quote_id, order_id, order_ref } = row

  // Foundation F-1 — classify and stamp order_type from the (already
  // nature-coerced, see step 1) cart lines: 'stock_on_hand' iff every line is
  // a genuine stock draw, else 'purchase_order'. The all-stocked twin of the
  // drawsStock (some-stocked) predicate at step 5c. The column defaults to
  // 'purchase_order' at the DB, so this update only ever narrows to
  // 'stock_on_hand' for fully-stocked orders.
  //
  // The order row is ALREADY committed by the RPC above (with the DB default),
  // so a failure here must NOT turn a placed order into a customer-facing 500 or
  // an orphan that skips the downstream Monday/notification steps. Instead we
  // fail-audit like every other post-commit side-effect in this function: record
  // ORDER_TYPE_STAMP_FAILED (so a mis-typed order is discoverable + re-stampable)
  // and continue. Worst case the order stays 'purchase_order' until re-stamped.
  const { error: orderTypeError } = await admin
    .from('orders')
    .update({ order_type: orderType })
    .eq('id', order_id)
  if (orderTypeError) {
    console.error('[Checkout] order_type stamp failed (audited, order committed)', {
      orderId: order_id,
      intendedType: orderType,
      err: orderTypeError.message,
    })
    try {
      await recordAuditEvent(
        {
          orgId: input.context.organizationId,
          actorUserId: input.context.userId,
          action: AUDIT_ACTIONS.ORDER_TYPE_STAMP_FAILED,
          targetType: 'order',
          targetId: order_id,
          metadata: { order_ref, intended_order_type: orderType, error: orderTypeError.message },
        },
        admin,
      )
    } catch (auditErr) {
      console.error('[Checkout] order_type stamp-failure audit threw (swallowed)', {
        orderId: order_id,
        err: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }
  }

  // Spec B — per-order billing signal + NZ picking fee. `billing_mode` per
  // VARIANT (Spec 3a — variant_inventory.billing_mode, not the catalogue
  // item's): invoice_on_dispatch = not-paid (draft quote, invoice before
  // dispatch), prepaid = goods already paid. `needsInvoicing` drives the Monday
  // billing note; `pickFee` feeds BOTH that note and the Xero draft (single
  // source of truth). Fee applies to stock-on-hand orders only
  // (order_type === 'stock_on_hand') and is NZD-only — AUS ship-to orders are
  // excluded here by the exact bill-country stamp.
  //
  // `billingModeByVariant` is resolved once at step 2c, before the RPC — the
  // drift guard there has to be able to throw without stranding a committed
  // order, and one read serves this note, the Xero zeroing and the billed total.
  // Record decoration revenue separately on the quote so finance can split
  // garment vs decoration without parsing quote_items.decorations jsonb.
  // total_amount already includes decoration via the folded unit_price above.
  if (totalDecorationRevenue > 0) {
    await admin
      .from('quotes')
      .update({ decoration_cost: totalDecorationRevenue })
      .eq('id', quote_id)
  }

  // The BILLED figures (spec 2026-07-17 D5) — what the customer is actually
  // invoiced, as against total_amount, which stays the full goods value so
  // Monday, staff order views and reporting are untouched.
  //
  // A SNAPSHOT, never recomputed on read: variant_inventory.billing_mode is
  // mutable, so re-deriving this later would silently rewrite what an old order
  // was billed.
  //
  // Written post-RPC with a plain update, exactly like decoration_cost above —
  // which is why neither needs a submit RPC line-contract change.
  await admin
    .from('quotes')
    .update({ picking_fee: round2(pickFee), billed_total: billedTotal })
    .eq('id', quote_id)

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
        terms_version: input.terms_version ?? null,
      },
    },
    admin,
  )

  // Design 2026-08-11 — dedicated consent signal. The route already guarantees
  // no order exists without an accepted, non-empty terms_version (the legal
  // gate); this is the clean queryable row. Best-effort like the audit writes
  // above — a failed write must never turn a committed order into a 500. One row
  // per order (two for a split cart); retries may duplicate (accepted), collapsed
  // in queries via the shared base idempotency_key.
  try {
    await recordAuditEvent(
      {
        orgId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: AUDIT_ACTIONS.TERMS_ACCEPTED,
        targetType: 'order',
        targetId: order_id,
        metadata: {
          order_ref,
          terms_version: input.terms_version ?? null,
          idempotency_key: input.idempotency_key,
        },
      },
      admin,
    )
  } catch (auditErr) {
    console.error('[Checkout] terms_accepted audit threw (swallowed, order committed)', {
      orderId: order_id,
      err: auditErr instanceof Error ? auditErr.message : String(auditErr),
    })
  }

  // 4. Apply per-line ship_to_store_id, location label, and the decorations
  //    snapshot. The RPC creates quote_items without any of these; we set them
  //    here (the country wrapper keeps the legacy line contract) — see buildLineSnapshotUpdate.
  const { data: newLines } = await admin
    .from('quote_items')
    .select('id, product_id, variant_id, size_id, product_name')
    .eq('quote_id', quote_id)
  if (newLines) {
    const rows = newLines as QuoteItemRow[]
    const consumed = new Set<string>()
    // PostgREST builders are thenables (PromiseLike), not full Promises, so type
    // the collection as PromiseLike — Promise.all accepts it directly.
    const snapshotUpdates: Array<PromiseLike<unknown>> = []
    for (const inLine of input.lines) {
      const match = rows.find(
        (x) =>
          !consumed.has(x.id) &&
          x.product_id === inLine.product_id &&
          (x.variant_id ?? null) === (inLine.variant_id ?? null) &&
          (x.size_id ?? null) === (inLine.size_id ?? null) &&
          x.product_name === inLine.product_name,
      )
      if (!match) continue
      consumed.add(match.id)
      const validated =
        validatedByLineKey.get(makeLineKey(inLine.product_id, inLine.variant_id ?? null, inLine.size_id ?? null)) ?? []
      const update = buildLineSnapshotUpdate(inLine, validated)
      if (Object.keys(update).length > 0) {
        // Collect and dispatch concurrently — one round-trip per line, but all
        // in flight at once instead of a serial await chain (N× faster tail on
        // large orders).
        snapshotUpdates.push(admin.from('quote_items').update(update).eq('id', match.id))
      }
    }
    await Promise.all(snapshotUpdates)
  }

  // 4a. Denormalise the order's single ship-to branch onto the quote header
  //     (location-manager feature, Option A 2026-07-27). The submit wrapper never
  //     stamps quote_items.ship_to_store_id (set post-RPC in step 4 above), so the
  //     header must be stamped here too. The buyer-scope guard (step 0) guarantees
  //     the lines are single-branch, so the first non-null store id is the whole
  //     order's branch; custom-address orders (all-null) stay NULL.
  //
  //     Best-effort + non-fatal: the quotes.ship_to_store_id column ships with the
  //     held migration. Until it is applied this update no-ops with a swallowed
  //     PostgREST error — the order must never fail because of a dark feature.
  const orderShipToStoreId = shipToStoreIds.find((sid) => sid !== null) ?? null
  if (orderShipToStoreId) {
    const { error: shipStampError } = await admin
      .from('quotes')
      .update({ ship_to_store_id: orderShipToStoreId })
      .eq('id', quote_id)
    if (shipStampError) {
      console.warn('[Checkout] quotes.ship_to_store_id stamp skipped (non-fatal)', {
        quoteId: quote_id,
        err: shipStampError.message,
      })
    }
  }

  // 4b. Pre-approved inventory write-through. When the customer ticked "Add
  //     all to my inventory" at checkout, orders.intent is 'inventory'. The
  //     RPC sets that flag but does NOT touch stock — stock only lands when
  //     staff later runs mark_inventory_received post-fulfilment. Jamie
  //     2026-05-21: at submit, treat each line as pre-approved inventory and
  //     write the stock immediately so it shows on the staff inventory page
  //     and the customer PDP availability the moment the order posts.
  //     Best-effort: a failure here logs + audits but does NOT roll back the
  //     order (the customer would be left with a successful checkout and no
  //     visible reason for the failure).
  //     v1 honours the order-level intent only — mixed mode is not in scope.
  if ((input.intent ?? 'customer') === 'inventory') {
    try {
      // Re-fetch lines from quote_items so we have the persisted variant_id
      // and the canonical post-decoration-fold unit_price. Avoids drift if
      // the RPC ever normalises prices further.
      const { data: invLines, error: invErr } = await admin
        .from('quote_items')
        .select('id, variant_id, quantity, unit_price')
        .eq('quote_id', quote_id)
      if (invErr) {
        throw new Error(`pre-approved inventory line lookup failed: ${invErr.message}`)
      }
      const rows = (invLines ?? []) as Array<{
        id: string
        variant_id: string | null
        quantity: number | null
        unit_price: number | null
      }>
      const skipped: string[] = []
      for (const r of rows) {
        if (!r.variant_id || !r.quantity || r.quantity <= 0) {
          skipped.push(r.id)
          continue
        }
        const { error: rpcErr } = await admin.rpc('mark_inventory_received', {
          p_organization_id: input.context.organizationId,
          p_variant_id: r.variant_id,
          p_qty: r.quantity,
          p_prepaid: false,
          p_unit_value: Number(r.unit_price ?? 0),
          p_reason: 'pre_approved_inventory',
          p_note: `Pre-approved at checkout — order ${order_ref}`,
          p_reference_quote_item_id: r.id,
        })
        if (rpcErr) {
          throw new Error(
            `mark_inventory_received failed for line ${r.id}: ${rpcErr.message}`,
          )
        }
      }
      await recordAuditEvent(
        {
          orgId: input.context.organizationId,
          actorUserId: input.context.userId,
          action: AUDIT_ACTIONS.ORDER_PRE_APPROVED_INVENTORY,
          targetType: 'order',
          targetId: order_id,
          metadata: { order_ref, quote_id, line_count: rows.length, skipped },
        },
        admin,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[Checkout] pre-approved inventory write failed (swallowed)', {
        orderId: order_id,
        err: message,
      })
      try {
        await recordAuditEvent(
          {
            orgId: input.context.organizationId,
            actorUserId: input.context.userId,
            action: AUDIT_ACTIONS.ORDER_PRE_APPROVED_INVENTORY_FAILED,
            targetType: 'order',
            targetId: order_id,
            metadata: { order_ref, quote_id, error: message },
          },
          admin,
        )
      } catch {
        // truly best-effort
      }
    }
  }

  // 4c. Auto-create a job_trackers shell row scoped to the customer's
  //     user_id so /order-tracker surfaces the order the moment they land on
  //     the confirmation page. monday_item_id starts NULL; step 5a stamps it
  //     after the Monday push succeeds. Best-effort: a failure here logs +
  //     audits but does NOT roll back the order — same contract as the
  //     Monday push and pre-approved-inventory paths.
  try {
    await createJobTrackerShellForOrder(admin, {
      quoteId: quote_id,
      orderRef: order_ref,
      organizationId: input.context.organizationId,
      userId: input.context.userId,
      customerEmail: input.context.email ?? null,
      customerName: input.context.organizationName,
      requiredBy: input.required_by ?? null,
      orderType,
      shippingAddress,
      currencyCode: billingCurrency,
    })
    await recordAuditEvent(
      {
        orgId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: AUDIT_ACTIONS.ORDER_JOB_TRACKER_CREATED,
        targetType: 'order',
        targetId: order_id,
        metadata: { order_ref, quote_id },
      },
      admin,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[Checkout] job tracker shell create failed (swallowed)', {
      orderId: order_id,
      err: message,
    })
    try {
      await recordAuditEvent(
        {
          orgId: input.context.organizationId,
          actorUserId: input.context.userId,
          action: AUDIT_ACTIONS.ORDER_JOB_TRACKER_CREATE_FAILED,
          targetType: 'order',
          targetId: order_id,
          metadata: { order_ref, quote_id, error: message },
        },
        admin,
      )
    } catch {
      // truly best-effort
    }
  }

  // 5b (moved in-request). Flip status to awaiting-proof-review BEFORE the
  //     deferred side-effects run: the confirmation page and order tracker read
  //     this status, so it must be set within the request — not in after().
  //     Independent of the Monday push result.
  await admin
    .from('orders')
    .update({ status: 'awaiting-proof-review' })
    .eq('id', order_id)

  // External side-effects (Monday, Xero, confirmation + dispatch emails,
  // Slack, Starshipit) run AFTER the response flushes — none are needed to
  // render the confirmation page. A dispatch-once compare-and-set on
  // orders.notifications_dispatched_at makes them idempotent across replays
  // and concurrent double-submits.
  after(async () => {
    const { data: claimed, error: claimErr } = await admin
      .from('orders')
      .update({ notifications_dispatched_at: new Date().toISOString() })
      .eq('id', order_id)
      .is('notifications_dispatched_at', null)
      .select('id')
    if (claimErr) {
      console.error('[Checkout] side-effect dispatch claim failed (swallowed)', {
        orderId: order_id,
        err: claimErr.message,
      })
      return
    }
    // Skip only when the compare-and-set explicitly claimed zero rows (this
    // order was already dispatched by a prior submit). A null payload without
    // an error only arises under test stubs that do not model .select(); treat
    // it as a fresh claim so real (array) semantics drive production.
    if (Array.isArray(claimed) && claimed.length === 0) {
      return
    }

    // 5. Hold the order for staff proof review. Customer-facing portal flow:
    //    submit → autofill proof + Monday deal + AM email → staff edits → staff
    //    push-to-customer → customer approves. No more AM-approve gate.
    //    See spec: 2026-05-21-checkout-monday-proof-pipeline-design.md.

    // 5a. Push to Monday CRM Deals board. Best-effort: if it fails, order still
    //     commits, audit row records the failure, staff can retry from the order
    //     detail page (Stage 4 surface).
    //
    // TODO(2026-05-21): this data-build block is duplicated in
    //   print-room-staff-portal/src/app/api/orders/[id]/retry-monday-push/route.ts.
    //   Extract to lib/orders/build-monday-payload.ts when a 3rd caller appears.
    //   Stage 4 deliberately kept the duplicate to avoid re-touching submit.ts.
    let mondayItemId: string | null = null
    const subitemIdByQuoteItemId: Record<string, string> = {}
    // Item 4 (board 5026203696 — "Orders page changes"): stock-on-hand orders
    // never reach Monday. They are picked from stock and shipped by Starshipit,
    // so a Monday card for one is a work instruction for goods that already
    // exist — phantom work in front of the floor. Their state is tracked by the
    // Starshipit webhook onto orders.fulfillment_status instead.
    //
    // Skipping the whole block (not just the pushOrderDeal call) is deliberate:
    // the billing note, the subitem-id writeback and the job_trackers
    // monday_item_id stamp below all describe a card that will not exist.
    // `mondayItemId` stays null, which the only downstream reader — the Xero
    // manual-review note at step 5c — already guards on.
    //
    // The staff portal enforces the same rule on its own push surfaces; the twin
    // lives at print-room-staff-portal/src/lib/orders/monday-push.ts.
    if (isStockOnHandOrder) {
      console.info('[Checkout] Monday push skipped — stock on hand', {
        orderId: order_id,
        order_ref,
      })
    } else {
      try {
        const { data: dealLines } = await admin
          .from('quote_items')
          .select(`
            id, product_id, product_name, quantity, unit_price, decorations, size_label, line_location_label, line_custom_name,
            product_variants ( product_color_swatches(label) )
          `)
          .eq('quote_id', quote_id)

        const lines: OrderLineForMonday[] = ((dealLines ?? []) as unknown as Array<{
          id: string
          product_id: string
          product_name: string
          quantity: number
          unit_price: number
          decorations: Array<{ name: string }> | null
          size_label: string | null
          line_location_label: string | null
          line_custom_name: string | null
          product_variants: {
            product_color_swatches: { label: string | null } | { label: string | null }[] | null
          } | null
        }>).map((row) => {
          const swatch = pickOne(row.product_variants?.product_color_swatches ?? null)
          const variantLabel = [swatch?.label, row.size_label].filter(Boolean).join(' / ') || '—'
          const designName = row.decorations?.[0]?.name ?? 'No decoration'
          return {
            quoteItemId: row.id,
            productId: row.product_id,
            productName: row.product_name,
            variantLabel,
            colorName: swatch?.label ?? null,
            sizeLabel: row.size_label,
            designName,
            location: row.line_location_label ?? null,
            customName: row.line_custom_name ?? null,
            quantity: row.quantity,
          }
        })

        // emailTotalAmount is declared AFTER step 5 in this file, so it's not in
        // scope here. Compute directly from repriced.
        const totalAmount = repriced.reduce((t, l) => t + l.unit_price * l.qty, 0)

        // Demo orgs route their Monday deal to the Demo group (same board) so
        // production's New Deals stays clean while the tracking round-trip
        // (monday_item_id → tracker-status webhook) keeps working.
        const { data: orgFlagRow } = await admin
          .from('organizations')
          .select('is_test')
          .eq('id', input.context.organizationId)
          .maybeSingle()
        const isTestOrg = Boolean((orgFlagRow as { is_test?: boolean } | null)?.is_test)

        const { itemId, subitemIds } = await pushOrderDeal(
          {
            customerEmail: input.context.email ?? '',
            customerName: input.context.organizationName,
            customerCompany: input.context.organizationName,
            orderRef: order_ref,
            inHandDate: input.required_by ?? null,
            notes: input.notes ?? null,
            totalAmount,
            currency: billingCurrency,
            lines,
            deliveryAddress: formattedShippingAddress,
          },
          { demo: isTestOrg },
        )

        mondayItemId = itemId
        Object.assign(subitemIdByQuoteItemId, subitemIds)

        // Persist back. Order row gets monday_item_id; each quote_items row gets
        // its monday_subitem_id so the existing tracker-status webhook can match
        // inbound Monday updates to portal-side lines.
        await admin.from('orders').update({ monday_item_id: itemId }).eq('id', order_id)
        for (const [quoteItemId, subitemId] of Object.entries(subitemIds)) {
          await admin
            .from('quote_items')
            .update({ monday_subitem_id: subitemId })
            .eq('id', quoteItemId)
        }

        // Item 11 — stock-on-hand orders carry a fixed production-hold note on their
        // Monday card so the floor pulls from stock instead of producing. Purchase
        // orders get no note. Own try/catch so a note failure never marks the whole
        // Monday push as failed (mirrors the Xero manual-review note in step 5c).
        // Spec B supersedes the flat Spec A note: stock-on-hand orders carry a
        // billing note stating whether goods need invoicing (not-paid) or are
        // prepaid, plus the pick fee. Purchase orders still get no note.
        const billingNote = isStockOnHandOrder
          ? orderBillingNote({ needsInvoicing, pickFee })
          : null
        if (billingNote) {
          try {
            await postItemUpdate(itemId, billingNote)
          } catch (noteErr) {
            console.error('[Checkout] billing note failed (swallowed)', {
              orderId: order_id,
              err: noteErr instanceof Error ? noteErr.message : String(noteErr),
            })
          }
        }

        // Stamp the same Monday item id onto the job_trackers shell created in
        // step 4c. Webhook-driven status updates from Monday already key off
        // monday_item_id (job_tracker_webhook_logs) so this enables inbound
        // status sync. Best-effort: failure audits but does NOT roll back.
        try {
          const { error: tErr } = await admin
            .from('job_trackers')
            .update({
              monday_item_id: Number(itemId),
              // Orders now land on the Production board — stamp it so tracker-based
              // Monday deep links resolve there, not a dead Deals URL.
              monday_board_id: PRODUCTION_BOARD_ID,
              last_synced_at: new Date().toISOString(),
            })
            .eq('quote_id', quote_id)
          if (tErr) throw new Error(tErr.message)
        } catch (tErr) {
          const tMsg = tErr instanceof Error ? tErr.message : String(tErr)
          console.error('[Checkout] job tracker monday_item_id stamp failed (swallowed)', {
            orderId: order_id,
            err: tMsg,
          })
          try {
            await recordAuditEvent(
              {
                orgId: input.context.organizationId,
                actorUserId: input.context.userId,
                action: AUDIT_ACTIONS.ORDER_JOB_TRACKER_MONDAY_LINK_FAILED,
                targetType: 'order',
                targetId: order_id,
                metadata: { order_ref, quote_id, monday_item_id: itemId, error: tMsg },
              },
              admin,
            )
          } catch {
            // truly best-effort
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[Checkout] Monday push failed (swallowed)', { orderId: order_id, err: message })
        try {
          await recordAuditEvent(
            {
              orgId: input.context.organizationId,
              actorUserId: input.context.userId,
              action: AUDIT_ACTIONS.ORDER_MONDAY_PUSH_FAILED,
              targetType: 'order',
              targetId: order_id,
              metadata: { order_ref, quote_id, error: message },
            },
            admin,
          )
        } catch {
          // truly best-effort
        }
      }
    }

    // 5b. F1 (spec 2026-05-13 §G.4) — best-effort proof shell so staff dashboards
    //     populate with customer-originated drafts the same way they do for staff-
    //     originated B2B submits. Pulls org/customer/order_ref from the quote
    //     because `orders` itself carries none of those signals (schema reality
    //     check — see §F.1). The helper never throws; failure paths collapse to
    //     an audit_events row so the order submit always succeeds.
    try {
      const { data: quote, error: quoteError } = await admin
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
      if (quoteError) {
        throw new Error(`Autofill quote lookup failed: ${quoteError.message}`)
      }

      const { data: lineRows, error: lineRowsError } = await admin
        .from('quote_items')
        .select('product_id')
        .eq('quote_id', quote_id)
      if (lineRowsError) {
        throw new Error(`Autofill quote item lookup failed: ${lineRowsError.message}`)
      }

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
      const message = e instanceof Error ? e.message : String(e)
      console.error('[Checkout] autofillProofForOrder threw (swallowed)', {
        orderId: order_id,
        err: message,
      })
      try {
        await recordAuditEvent(
          {
            orgId: input.context.organizationId,
            actorUserId: input.context.userId,
            action: AUDIT_ACTIONS.PROOF_AUTOFILL_FAILED,
            targetType: 'order',
            targetId: order_id,
            metadata: {
              order_ref,
              quote_id,
              error: message,
              source: 'checkout_submit_outer_catch',
            },
          },
          admin,
        )
      } catch (auditErr) {
        console.error('[Checkout] proof autofill failure audit threw (swallowed)', {
          orderId: order_id,
          err: auditErr instanceof Error ? auditErr.message : String(auditErr),
        })
      }
    }

    // 5c. Best-effort Xero DRAFT quote. Mirrors the Monday/email side-effects:
    //     never throws, audits on failure. Spec A: EVERY non-test order drafts —
    //     purchase orders and stock-on-hand alike. Only a test org is skipped
    //     (xero_invoice_status='skipped'); disabled/already-drafted are inert.
    //     Spec B: prepaid stocked goods are zeroed on the draft and the pick fee
    //     (computed above, region-gated to NZ) rides on its own line.
    try {
      // Any line whose VARIANT is prepaid. Whether it's actually zeroed is
      // gated downstream in draft-invoice.ts (qty_from_stock > 0): a drawn
      // prepaid line is zeroed in FULL; a prepaid variant's made-to-order PO
      // line (qty_from_stock 0) is charged. No partial draws (see plan header /
      // spec Domain rules) ⇒ no within-line split. Widened from the old
      // stocked-only set.
      const prepaidDrawnLineKeys = new Set(
        input.lines.flatMap((l) =>
          l.variant_id && billingModeByVariant.get(l.variant_id) === 'prepaid'
            ? [makeLineKey(l.product_id, l.variant_id ?? null, l.size_id ?? null)]
            : [],
        ),
      )
      const xeroOrgResult = await admin
        .from('organizations')
        .select('is_test')
        .eq('id', input.context.organizationId)
        .maybeSingle()
      // Fail closed on error OR a missing row: treat as a test org so we never push
      // a live Xero draft for an org we could not classify (mirrors the email +
      // dispatch recipient lookups).
      const xeroIsTestOrg = isTestOrgFailClosed(
        xeroOrgResult as { data: { is_test?: boolean | null } | null; error: unknown },
      )

      const xeroResult = await createDraftInvoiceForOrder(admin, {
        orderId: order_id,
        orderRef: order_ref,
        quoteId: quote_id,
        organizationId: input.context.organizationId,
        organizationName: input.context.organizationName,
        // Quote is made out to the ship-to location; one destination per order
        // (mixed-address guard), so the first line's store speaks for all.
        shipToStoreId: input.lines[0]?.ship_to_store_id ?? null,
        actorUserId: input.context.userId,
        ordererEmail: input.context.email ?? null,
        paymentTerms: input.context.paymentTerms ?? null,
        isTestOrg: xeroIsTestOrg,
        orgRegion: xeroRegionForBillCountry(billCountry),
        billCountry,
        pickingFee: pickFee,
        prepaidDrawnLineKeys,
        existingInvoiceId: null, // fresh order — no prior draft
        today: new Date().toISOString().slice(0, 10),
        deliveryAddressSummary: formattedShippingAddress,
      })

      // Surface a manual-quote flag where Charlotte works (best-effort within
      // this already-best-effort block). The orchestrator already set the DB
      // status + audit; this is just the human-visible nudge on the Monday card.
      if (xeroResult.status === 'manual_review' && mondayItemId) {
        try {
          await postItemUpdate(
            mondayItemId,
            `Manual Xero quote required — this order was not auto-drafted in Xero ` +
              `(reason: ${xeroResult.reason}). Please raise the quote manually.`,
          )
        } catch (noteErr) {
          console.error('[Checkout] Xero manual-review Monday note failed (swallowed)', {
            orderId: order_id,
            err: noteErr instanceof Error ? noteErr.message : String(noteErr),
          })
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[Checkout] Xero draft quote failed (swallowed)', { orderId: order_id, err: message })
      try {
        await recordAuditEvent(
          {
            orgId: input.context.organizationId,
            actorUserId: input.context.userId,
            action: AUDIT_ACTIONS.ORDER_XERO_DRAFT_FAILED,
            targetType: 'order',
            targetId: order_id,
            metadata: { order_ref, quote_id, error: message },
          },
          admin,
        )
      } catch {
        // truly best-effort
      }
    }

    // 5d. Best-effort Starshipit push-at-placement. Registers an UNSHIPPED order
    //     carrying delivery details so staff can generate the label + tracking in
    //     Starshipit; the portal webhook writes the tracking link back onto the
    //     job_trackers row. Dark by default (STARSHIPIT_ENABLED). Mirrors the
    //     Monday/Xero side-effects: never throws out of submit, audits on failure.
    //     While the flag is OFF this block is FULLY INERT — no org query, no
    //     'disabled' audit row on every checkout (same convention as the Xero
    //     step's 'disabled' → no write, no audit).
    if (isStarshipitEnabled()) {
    try {
      const { data: ssOrgRow } = await admin
        .from('organizations')
        .select('is_test')
        .eq('id', input.context.organizationId)
        .maybeSingle()
      const ssIsTestOrg = Boolean((ssOrgRow as { is_test?: boolean } | null)?.is_test)

      const ssResult = await pushOrderToStarshipit(admin, {
        orderId: order_id,
        orderRef: order_ref,
        quoteId: quote_id,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        trigger: 'placement',
        intent: input.intent ?? 'customer',
        isTestOrg: ssIsTestOrg,
        region: xeroRegionForBillCountry(billCountry),
        billCountry,
        isStockOnHand: isStockOnHandOrder,
        customerEmail: input.context.email ?? null,
        shippingAddress,
        // orderType (delivery/pickup discriminator) intentionally NOT passed —
        // the portal has no pickup concept. Starshipit dispatch is gated on the
        // Spec A stock/production axis via isStockOnHand: a purchase-order (any
        // made-to-order line) skips with reason 'not_stock_on_hand'.
      })
      if (ssResult.status === 'skipped') {
        await recordAuditEvent(
          {
            orgId: input.context.organizationId,
            actorUserId: input.context.userId,
            action: AUDIT_ACTIONS.ORDER_STARSHIPIT_SKIPPED,
            targetType: 'order',
            targetId: order_id,
            metadata: { order_ref, billCountry, reason: ssResult.reason },
          },
          admin,
        )
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[Checkout] Starshipit push failed (swallowed)', { orderId: order_id, err: message })
      try {
        await recordAuditEvent(
          {
            orgId: input.context.organizationId,
            actorUserId: input.context.userId,
            action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSH_FAILED,
            targetType: 'order',
            targetId: order_id,
            metadata: { order_ref, quote_id, error: message },
          },
          admin,
        )
      } catch {
        // truly best-effort
      }
    }
    }

    // Fetch the email payload from quotes/quote_items for the confirmation email below.
    let emailLines: OrderConfirmationLine[] = []
    let emailTotalAmount: number | null = null
    let emailPickingFee = 0
    let emailPrepaidGoodsValue = 0
    let emailRequiredBy: string | null = input.required_by ?? null
    let emailCustomerName = input.context.organizationName
    try {
      const { data: q } = await admin
        .from('quotes')
        .select('customer_name, total_amount, picking_fee, billed_total, required_by')
        .eq('id', quote_id)
        .single()
      const quote = q as QuoteRowForEmail | null
      if (quote) {
        // The customer email shows what we INVOICE, not the goods value — the
        // same billedFigures the confirmation page uses, so the two agree.
        const figures = billedFigures({
          goodsExGst: Number(quote.total_amount),
          billedTotal: quote.billed_total,
          pickingFee: quote.picking_fee,
        })
        emailTotalAmount = figures.billedExGst
        emailPickingFee = figures.pickingFee
        emailPrepaidGoodsValue = figures.prepaidGoodsValue
        emailRequiredBy = quote.required_by ?? emailRequiredBy
        emailCustomerName = quote.customer_name
      }

      const { data: lines } = await admin
        .from('quote_items')
        .select(
          `product_name, quantity, unit_price, size_label,
           product_variants (
             product_color_swatches (label)
           )`
        )
        .eq('quote_id', quote_id)
      const lineRows = (lines ?? []) as unknown as QuoteItemForEmail[]
      emailLines = lineRows.map((l) => {
        const swatch = pickOne(l.product_variants?.product_color_swatches ?? null)
        const variantLabel = [swatch?.label, l.size_label].filter(Boolean).join(' / ') || '—'
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

        const emailOrgResult = await admin
          .from('organizations').select('is_test').eq('id', input.context.organizationId).maybeSingle()
        // Fail closed on error OR a missing row: route to the test inbox rather than risk emailing a real customer.
        const isTestOrgForEmail = isTestOrgFailClosed(
          emailOrgResult as { data: { is_test?: boolean | null } | null; error: unknown },
        )
        const emailRecipient = resolveOrderEmailRecipient({
          isTestOrg: isTestOrgForEmail,
          customerEmail: input.context.email,
          testEmail: 'jamie@theprint-room.co.nz',
        })

        const result = await sendOrderConfirmation({
          to: emailRecipient,
          customerName: emailCustomerName,
          orderId: order_id,
          orderRef: order_ref,
          currency: billingCurrency,
          totalAmount: fallbackTotal,
          // Both 0 on the fallback path (quote fetch failed): fallbackTotal is
          // the goods sum, so the order over-quotes rather than under-quotes —
          // the same fail-closed trade as everywhere else.
          pickingFee: emailPickingFee,
          prepaidGoodsValue: emailPrepaidGoodsValue,
          requiredBy: emailRequiredBy,
          lines: fallbackLines,
          provisionalUntil:
            openPeriod && preOrderItemIds.size > 0 ? openPeriod.closesAt : null,
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

    // 7. Order-placed dispatch notification (Item 13). Fires for EVERY order the
    //    moment it commits: a Block Kit Slack message (no-op until the webhook env
    //    exists) plus an email to the dispatch desk (charlotte@ in prod, or the
    //    test inbox for demo orgs). Best-effort — a notification failure must
    //    never break the order. Reuses the step-6 email summary + a STAFF-portal
    //    deep link to the order detail page. (Previously linked the CUSTOMER
    //    portal's confirmation page, which forced staff through a customer login
    //    wall — see staffOrderUrl / lib/config/staff-portal-url.ts.)
    try {
      const notifyOrderUrl = staffOrderUrl(order_id)

      const notifyLines =
        emailLines.length > 0
          ? emailLines
          : repriced.map((l) => ({
              productName: l.product_name,
              variantLabel: '—',
              quantity: l.qty,
              unitPrice: l.unit_price,
            }))
      const notifyTotal =
        emailTotalAmount ?? repriced.reduce((t, l) => t + l.unit_price * l.qty, 0)

      const notifyOrgResult = await admin
        .from('organizations')
        .select('is_test')
        .eq('id', input.context.organizationId)
        .maybeSingle()
      // Fail closed: an unknown org classification (lookup error OR missing row)
      // must never notify Charlotte — route to the test inbox instead.
      const notifyIsTestOrg = isTestOrgFailClosed(
        notifyOrgResult as { data: { is_test?: boolean | null } | null; error: unknown },
      )
      if (notifyOrgResult.error || !notifyOrgResult.data) {
        console.error(
          '[Checkout] dispatch recipient lookup unresolved; routing to test inbox',
          notifyOrgResult.error?.message ?? 'org row not found',
        )
      }

      await postOrderPlacedSlack({
        orderRef: order_ref,
        customerName: emailCustomerName,
        orderType,
        totalAmount: notifyTotal,
        currency: billingCurrency,
        orderUrl: notifyOrderUrl,
        lines: notifyLines.map((l) => ({
          productName: l.productName,
          variantLabel: l.variantLabel,
          quantity: l.quantity,
        })),
      })

      // Dispatch desk email is internal + fires only for real customer orgs.
      // Test/demo orgs already route the customer confirmation to the test inbox;
      // suppress the dispatch copy so a tester sees exactly one email.
      if (!notifyIsTestOrg) {
        const dispatchRecipient = resolveDispatchNotificationRecipient({
          isTestOrg: notifyIsTestOrg,
          testEmail: 'jamie@theprint-room.co.nz',
        })
        await sendOrderPlacedDispatch({
          to: dispatchRecipient,
          orderRef: order_ref,
          customerName: emailCustomerName,
          orderType,
          currency: billingCurrency,
          totalAmount: notifyTotal,
          orderUrl: notifyOrderUrl,
          ordererName: input.context.fullName,
          ordererEmail: input.context.email,
          deliveryAddress: formattedShippingAddress,
          lines: notifyLines,
        })
      }
    } catch (e) {
      console.error('[Checkout] order-placed dispatch notification failed (swallowed)', {
        orderId: order_id,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  })

  return { order_id, order_ref }
}
