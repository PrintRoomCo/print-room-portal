import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { B2BCustomerContext } from '@/lib/checkout/server'
import { effectiveDecorationPrice, loadTierMultiplier } from '@/lib/checkout/decoration-effective-price'
import { sendOrderConfirmation } from '@/lib/email/order-confirmation'
import { resolveOrderEmailRecipient } from './order-email-recipient'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'
import { getEffectiveMoq } from '@/lib/shop/effective-moq'
import { effectiveUnitPriceForItem } from '@/lib/shop/effective-price'
import { autofillProofForOrder } from '@/lib/proofs/autofill-for-order'
import { pushOrderDeal, type OrderLineForMonday } from '@/lib/monday/deal-item'
import { PRODUCTION_BOARD_ID } from '@/lib/monday/column-ids'
import { createJobTrackerShellForOrder } from '@/lib/orders/job-tracker'
import { classifyOrderType } from '@/lib/orders/order-type'
import { getOpenPeriodForOrg, getPreOrderItemIds } from '@/lib/pricing/period-brackets'
import { createDraftInvoiceForOrder } from '@/lib/xero/draft-invoice'
import { pushOrderToStarshipit } from '@/lib/starshipit/push-order'
import { isStarshipitEnabled } from '@/lib/starshipit/config'
import { postItemUpdate } from '@/lib/monday/updates'
import { orderBillingNote } from '@/lib/monday/billing-note'
import { orderNeedsInvoicing } from './order-billing'
import { resolveLineBillingModes } from './resolve-line-billing-modes'
import { orderPickingFee } from '@/lib/pricing/order-picking-fee'
import { round2 } from '@/lib/pricing/pricingMath'
import { isPrepaidDrawn } from '@/lib/shop/prepaid-tag'
import { billedFigures } from '@/lib/checkout/billed-figures'
import type { BillingMode } from '@/lib/shop/billing-mode'
import { formatShippingAddress } from '@/lib/checkout/shipping-address'
import { postOrderPlacedSlack } from '@/lib/notifications/slack-order-placed'
import { sendOrderPlacedDispatch } from '@/lib/email/order-placed-dispatch'
import {
  resolveDispatchNotificationRecipient,
  isTestOrgFailClosed,
} from '@/lib/checkout/dispatch-notification-recipient'

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
   * submit_b2b_order's p_lines so the order records which skin sold. camelCase
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

export interface UnitPriceDrift {
  cartLineId: string | null
  productId: string
  productName: string
  qty: number
  claimedUnitPrice: number
  canonicalUnitPrice: number
}

export class UnitPriceDriftError extends Error {
  readonly drift: UnitPriceDrift[]
  constructor(drift: UnitPriceDrift[]) {
    super('unit_price_drift')
    this.name = 'UnitPriceDriftError'
    this.drift = drift
  }
}

export interface BillingModeDrift {
  cartLineId: string | null
  productId: string
  productName: string
  claimedBillingMode: BillingMode
  canonicalBillingMode: BillingMode
}

export class BillingModeDriftError extends Error {
  readonly drift: BillingModeDrift[]
  constructor(drift: BillingModeDrift[]) {
    super('billing_mode_drift')
    this.name = 'BillingModeDriftError'
    this.drift = drift
  }
}

/**
 * Compare each line's claimed billing mode against the canonical one. Pure, so
 * the both-directions rule is testable without a database.
 *
 * A line with no claim is skipped (legacy cart — mirrors the has_brackets gate
 * on unit_price_drift). An unknown variant, or no variant at all, resolves to
 * invoice_on_dispatch — the same fail-closed rule as resolve-line-billing-modes.
 */
export interface BilledTotalLine {
  /** fulfilment_type === 'stocked' — this line DREW stock. */
  stocked: boolean
  billingMode: BillingMode
  /** qty × repriced garment unit price, ex decoration. */
  goodsValue: number
  /** qty × per-unit decoration for this line. */
  decorationRevenue: number
}

/**
 * The ex-GST figure we actually invoice: goods + decoration for every line that
 * is NOT a prepaid stock draw, plus the picking fee.
 *
 * Decoration on a prepaid draw is excluded too — it was paid for along with the
 * stock. Handled per line rather than folded into goodsValue because decoration
 * revenue is tracked separately for finance (quotes.decoration_cost).
 *
 * Uses the same isPrepaidDrawn predicate as the customer-facing shape, so the
 * server and the checkout page cannot disagree about which lines are free.
 */
export function billedOrderTotal(lines: BilledTotalLine[], pickFee: number): number {
  const billedGoods = lines.reduce((total, line) => {
    if (isPrepaidDrawn(line.stocked ? 'stocked' : 'made_to_order', line.billingMode)) {
      return total
    }
    return total + line.goodsValue + line.decorationRevenue
  }, 0)
  return round2(billedGoods + pickFee)
}

export function buildBillingModeDrift(
  lines: Array<
    Pick<
      CheckoutLineInput,
      'product_id' | 'product_name' | 'variant_id' | 'cart_line_id' | 'claimed_billing_mode'
    >
  >,
  canonicalByVariant: Map<string, BillingMode>,
): BillingModeDrift[] {
  const drift: BillingModeDrift[] = []
  for (const line of lines) {
    if (line.claimed_billing_mode == null) continue
    const canonical: BillingMode = line.variant_id
      ? canonicalByVariant.get(line.variant_id) ?? 'invoice_on_dispatch'
      : 'invoice_on_dispatch'
    if (line.claimed_billing_mode !== canonical) {
      drift.push({
        cartLineId: line.cart_line_id ?? null,
        productId: line.product_id,
        productName: line.product_name,
        claimedBillingMode: line.claimed_billing_mode,
        canonicalBillingMode: canonical,
      })
    }
  }
  return drift
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

export class MixedShippingAddressError extends Error {
  constructor() {
    super('mixed_shipping_address')
    this.name = 'MixedShippingAddressError'
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
 * them here (submit_b2b_order stays unchanged). Each field is only written when
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

/**
 * Aggregation key for cart-tier band lookup — mirrors recomputeProductTierPrices
 * in lib/cart/types.ts so submit and cart agree on what qty pools. Variant +
 * fulfilmentType are intentionally excluded (different sizes / fulfilment of
 * the same product+signature still pool); decoration signature splits product
 * lines that share product_id but differ in decoration methods/artworks.
 *
 * Keyed on `decorationId` (org_decorations.id), not `linkId`
 * (b2b_catalogue_item_decorations.id). A single decoration that's wired onto
 * multiple swatches has one decorationId but one link row per swatch — keying
 * on linkId would split per-colour-variant lines into separate tier buckets.
 */
export function tierAggregationKey(
  productId: string,
  decorations: CheckoutLineDecorationInput[] | undefined,
): string {
  return `${productId}::${decorationAggregationSignature(decorations)}`
}

function decorationAggregationSignature(
  decorations: CheckoutLineDecorationInput[] | undefined,
): string {
  return !decorations || decorations.length === 0
    ? ''
    : decorations
        .map((d) => d.decorationId)
        .slice()
        .sort()
        .join('|')
}

function garmentPriceAggregationKey(line: CheckoutLineInput): string {
  const itemOrProduct = line.catalogueItemId
    ? `item:${line.catalogueItemId}`
    : `product:${line.product_id}`
  return `${itemOrProduct}::${decorationAggregationSignature(line.decorations)}`
}

// b2b_accounts.payment_terms CHECK constraint allows only 'prepay' | 'net20' | 'net30'.
// Plan default was 'net_20' which fails; use 'net20' instead.
const PAYMENT_TERMS_FALLBACK = 'net20'

export async function submitCustomerOrder(
  admin: SupabaseClient,
  input: CheckoutInput
): Promise<CheckoutResult> {
  // Preview is read-only — block the order RPC as belt-and-braces (the API
  // route already rejects preview at the write gate). No CheckoutResult error
  // variant exists, so throw.
  if (input.context.isPreview) {
    throw new Error('Preview only — nothing was saved.')
  }

  const shipToStoreIds = input.lines.map((l) => l.ship_to_store_id ?? null)
  const hasOneTimeLine = shipToStoreIds.some((sid) => sid === null)
  const allOneTimeLines = shipToStoreIds.every((sid) => sid === null)
  if ((hasOneTimeLine || input.custom_shipping_address) && !allOneTimeLines) {
    throw new MixedShippingAddressError()
  }

  // 0. Buyer-scope guard: plain staff (zero grants) are locked to their
  //    defaultStoreId — resolveBranchStoreIds([], default) === [default], today's
  //    single-branch lock. A manager (≥1 b2b_member_store_grants row) may pick any
  //    granted branch, but the order stays one-destination (mixed_branch → error).
  //    One-time shared address lines stay exempt via allOneTimeLines.
  if (input.context.role === 'staff') {
    const allowedBranches = resolveBranchStoreIds(
      input.context.branchStoreIds,
      input.context.defaultStoreId,
    )
    const res = checkStaffBranchScope({
      shipToStoreIds,
      allowedBranches,
      allOneTimeLines,
      hasCustomShippingAddress: Boolean(input.custom_shipping_address),
    })
    if (!res.ok && res.kind === 'out_of_scope') {
      throw new BuyerScopeError(res.mismatched, input.context.defaultStoreId)
    }
    if (!res.ok && res.kind === 'mixed_branch') {
      throw new MixedShippingAddressError()
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
  const formattedShippingAddress = formatShippingAddress(shippingAddress)

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
      .select('id, moq, fulfilment_type')
      .in('id', productIds),
    admin
      .from('b2b_catalogue_items')
      .select('id, source_product_id, moq_override, fulfilment_type_override')
      .in('source_product_id', productIds)
      .in('id', Array.from(grantedItemIds)),
  ])
  const productRows = (productMoqRows ?? []) as Array<{
    id: string
    moq: number | null
    fulfilment_type: string | null
  }>
  const catItemRows = (catItemMoqRows ?? []) as Array<{
    id: string
    source_product_id: string
    moq_override: number | null
    fulfilment_type_override: string | null
  }>
  const productMoqById = new Map(productRows.map((r) => [r.id, r.moq]))
  const overrideByProductId = new Map(
    catItemRows.map((r) => [r.source_product_id, r.moq_override]),
  )

  // Server-side fulfilment truth (2026-07-06). 'stocked' is a stock-DRAW claim
  // that exempts a line from MOQ (below) — so it may only stand when the
  // product's effective nature actually allows a draw. (Spec A no longer gates
  // Xero on stock-draw; the coercion still matters for MOQ + Spec B.)
  // submit_b2b_order resolves fulfilment the same way
  // (catalogue override ?? product base) and never draws on-hand stock for
  // made_to_order/pre_order natures, so a 'stocked' claim there is always
  // wrong — the old PDP fallback bug, stale persisted carts, or a hostile
  // client. Coerce in place so every downstream reader of input.lines sees
  // the truth. Absent claims (legacy carts) stay absent: MOQ-conservative.
  const natureByProductId = new Map(productRows.map((r) => [r.id, r.fulfilment_type]))
  const natureOverrideByCatItemId = new Map(
    catItemRows.map((r) => [r.id, r.fulfilment_type_override]),
  )
  const natureOverrideByProductId = new Map<string, string>()
  for (const r of catItemRows) {
    if (
      r.fulfilment_type_override != null &&
      !natureOverrideByProductId.has(r.source_product_id)
    ) {
      natureOverrideByProductId.set(r.source_product_id, r.fulfilment_type_override)
    }
  }
  for (const line of input.lines) {
    if (line.fulfilment_type !== 'stocked') continue
    const effectiveNature =
      (line.catalogueItemId != null
        ? natureOverrideByCatItemId.get(line.catalogueItemId)
        : null) ??
      natureOverrideByProductId.get(line.product_id) ??
      natureByProductId.get(line.product_id) ??
      'made_to_order'
    if (effectiveNature !== 'stocked' && effectiveNature !== 'mixed') {
      line.fulfilment_type = 'made_to_order'
    }
  }

  // Qty per product destined for a NEW production run — i.e. excluding lines
  // fulfilled from existing stock. MOQ is checked against this, not the grand
  // total: stock that has already been made carries no minimum. A line only
  // escapes MOQ when it declares fulfilment_type 'stocked' AND the claim
  // survived the nature coercion above; an absent value (legacy carts)
  // conservatively still counts toward MOQ. Built AFTER coercion on purpose.
  const productionQtyByProductId = new Map<string, number>()
  for (const line of input.lines) {
    if (line.fulfilment_type === 'stocked') continue
    productionQtyByProductId.set(
      line.product_id,
      (productionQtyByProductId.get(line.product_id) ?? 0) + line.qty,
    )
  }
  const moqViolations: MoqViolation[] = []
  // Report a violation per offending line (not per product) so the cart UI
  // can highlight every row affected, consistent with DecorationDriftError.
  // Stock-fulfilled lines are skipped — already-made stock has no MOQ.
  for (const line of input.lines) {
    if (line.fulfilment_type === 'stocked') continue
    const effectiveMoq = getEffectiveMoq(
      { moq: productMoqById.get(line.product_id) ?? null },
      overrideByProductId.has(line.product_id)
        ? { moq_override: overrideByProductId.get(line.product_id) ?? null }
        : null,
      { orgMoqExempt: input.context.moqExempt },
    )
    const totalQty = productionQtyByProductId.get(line.product_id) ?? line.qty
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
  // Catalogue item lines use the exact b2b_catalogue_items.id from the cart so
  // two skins on the same source product never collapse into one product-level
  // price bucket. Legacy/global lines keep the product-level effective price.
  //
  // Garment pricing still includes the decoration signature in its key, matching
  // the cart's historical tier behavior for decorated runs. Decoration pricing
  // below keeps its own product+decoration aggregation, so item-aware garment
  // pricing does not silently alter decoration-tier pooling.
  // Pooling seeds from the FULL cart when the route split it into partitions
  // (pricing_pool_lines), so a product spanning both partitions still prices
  // at the tier the whole cart earned — identical to a single submit call.
  const poolLines = input.pricing_pool_lines ?? input.lines
  const totalQtyByDecorationTierKey = new Map<string, number>()
  for (const line of poolLines) {
    const k = tierAggregationKey(line.product_id, line.decorations)
    totalQtyByDecorationTierKey.set(
      k,
      (totalQtyByDecorationTierKey.get(k) ?? 0) + line.qty,
    )
  }

  const garmentPriceGroups = new Map<
    string,
    { productId: string; catalogueItemId: string | null; totalQty: number }
  >()
  for (const line of poolLines) {
    const k = garmentPriceAggregationKey(line)
    const existing = garmentPriceGroups.get(k)
    if (existing) {
      existing.totalQty += line.qty
    } else {
      garmentPriceGroups.set(k, {
        productId: line.product_id,
        catalogueItemId: line.catalogueItemId ?? null,
        totalQty: line.qty,
      })
    }
  }

  // PRE-ORDER: lines on pre_order items price from the period snapshot
  // (worst case = own qty band; the close worker can only lower it).
  // Pool-wide so a shared price group prices via the correct path even when
  // the pre_order line itself sits in the other partition.
  const cartCatalogueItemIds = Array.from(
    new Set(
      poolLines
        .map((l) => l.catalogueItemId)
        .filter((v): v is string => Boolean(v)),
    ),
  )
  const openPeriod = await getOpenPeriodForOrg(admin, input.context.organizationId)
  const preOrderItemIds = openPeriod
    ? await getPreOrderItemIds(admin, cartCatalogueItemIds)
    : new Set<string>()

  const garmentPriceByKey = new Map<string, number>()
  await Promise.all(
    Array.from(garmentPriceGroups.entries()).map(async ([priceKey, group]) => {
      if (
        group.catalogueItemId &&
        openPeriod &&
        preOrderItemIds.has(group.catalogueItemId)
      ) {
        const { data: unit } = await admin.rpc('period_unit_price', {
          p_period_id: openPeriod.id,
          p_catalogue_item_id: group.catalogueItemId,
          p_qty: group.totalQty,
        })
        garmentPriceByKey.set(priceKey, Number(unit ?? 0))
        return
      }

      if (group.catalogueItemId) {
        const unit = await effectiveUnitPriceForItem(
          admin,
          group.catalogueItemId,
          input.context.organizationId,
          group.totalQty,
        )
        garmentPriceByKey.set(priceKey, unit)
        return
      }

      const { data: unit } = await admin.rpc('effective_unit_price', {
        p_product_id: group.productId,
        p_org_id: input.context.organizationId,
        p_qty: group.totalQty,
      })
      garmentPriceByKey.set(priceKey, Number(unit ?? 0))
    }),
  )

  const repriced = input.lines.map(l => ({
    ...l,
    unit_price:
      garmentPriceByKey.get(garmentPriceAggregationKey(l)) ?? 0,
  }))

  // 2a. Defensive unit-price drift guard. Only kicks in when the cart carried
  //     a brackets snapshot (post-2026-05-15) — for legacy carts (no
  //     has_brackets flag) we keep the historical silent re-price path. The
  //     cart already re-derives unitPrice from its bracket snapshot on every
  //     qty edit (CartProvider.updateLine + pickBracket), so a mismatch here
  //     means the snapshot diverged from the live tier (e.g. AM changed
  //     pricing while the customer was checking out).
  const PRICE_DRIFT_TOLERANCE = 0.005
  const unitPriceDrift: UnitPriceDrift[] = []
  for (const line of input.lines) {
    if (!line.has_brackets) continue
    if (typeof line.claimed_unit_price !== 'number') continue
    const canonical =
      garmentPriceByKey.get(garmentPriceAggregationKey(line)) ?? 0
    if (Math.abs(line.claimed_unit_price - canonical) > PRICE_DRIFT_TOLERANCE) {
      unitPriceDrift.push({
        cartLineId: line.cart_line_id ?? null,
        productId: line.product_id,
        productName: line.product_name,
        qty: line.qty,
        claimedUnitPrice: line.claimed_unit_price,
        canonicalUnitPrice: canonical,
      })
    }
  }
  if (unitPriceDrift.length > 0) {
    throw new UnitPriceDriftError(unitPriceDrift)
  }

  // 2c. Per-variant billing modes + the drift guard (spec 2026-07-17 D4).
  //     MUST run before the RPC at step 3: this throws, and a throw after the
  //     RPC would leave a committed order behind while still failing the
  //     customer. The resolved map is reused at step 5c (Xero zeroing), by the
  //     Monday billing note and by the billed-total snapshot, so there is
  //     exactly ONE read per submit.
  const billingVariantIds = Array.from(
    new Set(input.lines.map((l) => l.variant_id).filter((v): v is string => !!v)),
  )
  const billingModeByVariant = await resolveLineBillingModes(
    admin,
    input.context.organizationId,
    billingVariantIds,
  )
  const billingModeDrift = buildBillingModeDrift(input.lines, billingModeByVariant)
  if (billingModeDrift.length > 0) {
    throw new BillingModeDriftError(billingModeDrift)
  }

  // 2b. Re-validate every selected decoration on every line. Server-side
  //     read of the link table + org_decoration; reject on cross-org reuse,
  //     unattached link, inactive decoration, mismatched catalogue item, or
  //     price drift greater than zero (per Decision #3 — no tolerance, AM
  //     edits are explicit). Validated decorations get persisted onto the
  //     order line as a jsonb snapshot below in step 4.
  //
  //     Decoration tier qty uses the same (product_id, decoration_signature)
  //     aggregate as the garment above — keeps server and cart in lockstep on
  //     band lookup. Two lines that share product + signature pool qty for the
  //     engine; subset / different-signature lines don't. The earlier
  //     by-linkId aggregation was looser and could pool qty across distinct
  //     signatures that happened to share a linkId.

  const validatedByLineKey = new Map<string, CheckoutLineDecorationInput[]>()
  // Phase 2 — catalogue_item_id each line's decoration links resolve to, used
  // only as a drift cross-check against the line's own catalogueItemId.
  const decoCatalogueItemIdByLineKey = new Map<string, string>()
  // Manual-final (2026-06-10) — the engine's combined decoration figure per line
  // key (one number for the whole item). When set it is the authoritative per-unit
  // decoration cost; the per-placement sum is NOT used. Absent for computed lines.
  const manualDecorationByLineKey = new Map<string, number>()
  const drift: DecorationDrift[] = []

  // Manual-final (2026-06-10): a line is manual iff its catalogue item's
  // price_mode = 'manual_final'. We read it from the DB (authoritative) rather
  // than inferring from a non-null decoration RPC — a manual item priced below
  // its lowest decoration band returns NULL but must still bill 0 decoration,
  // NOT fall through to the per-placement rate-sheet sum.
  const lineItemIds = Array.from(
    new Set(input.lines.map((l) => l.catalogueItemId).filter((x): x is string => !!x)),
  )
  const manualItemIds = new Set<string>()
  if (lineItemIds.length > 0) {
    const { data: pmRows } = await admin
      .from('b2b_catalogue_items')
      .select('id, price_mode')
      .in('id', lineItemIds)
    for (const r of (pmRows ?? []) as Array<{ id: string; price_mode: string | null }>) {
      if (r.price_mode === 'manual_final') manualItemIds.add(r.id)
    }
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

  // One batched link fetch for the whole order (was one select per line — the
  // checkout round-trip fan-out, see PERF-FINDINGS.md). Chunked to keep the
  // PostgREST `in` filter bounded. A dec.linkId missing from the map is
  // 'detached', exactly as it was with the per-line select.
  const allLinkIds = Array.from(
    new Set(input.lines.flatMap((l) => (l.decorations ?? []).map((d) => d.linkId))),
  )
  const linkRowById = new Map<string, LinkRow>()
  for (let i = 0; i < allLinkIds.length; i += 100) {
    const { data: linkRows, error: linkErr } = await admin
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
      .in('id', allLinkIds.slice(i, i + 100))
      .eq('is_published', true)
    if (linkErr) {
      throw new Error(`decoration lookup failed: ${linkErr.message}`)
    }
    for (const r of (linkRows as unknown as LinkRow[]) ?? []) linkRowById.set(r.id, r)
  }

  // Decoration tier qty for a line — pooled across same product+signature
  // lines, mirroring the cart (the same aggregate the loop used per line).
  const decorationQtyForLine = (line: CheckoutLineInput): number =>
    totalQtyByDecorationTierKey.get(tierAggregationKey(line.product_id, line.decorations)) ??
    line.qty

  const isManualCheckoutLine = (line: CheckoutLineInput): boolean =>
    !!line.catalogueItemId && manualItemIds.has(line.catalogueItemId)

  // Pre-resolve every decoration price this order needs, concurrently and
  // deduplicated: manual lines need ONE combined figure per distinct
  // (catalogue item, pooled qty); computed decorations need one engine price
  // per distinct (link, pooled qty). Only structurally-valid rows are priced —
  // rejected placements (detached/cross-org/inactive/wrong-item) never were.
  const manualPairs = new Map<string, { itemId: string; qty: number }>()
  const computedPairs = new Map<string, { row: LinkRow; qty: number }>()
  for (const line of input.lines) {
    const qty = decorationQtyForLine(line)
    if (isManualCheckoutLine(line) && line.catalogueItemId) {
      manualPairs.set(`${line.catalogueItemId}::${qty}`, { itemId: line.catalogueItemId, qty })
      continue
    }
    for (const dec of line.decorations ?? []) {
      const row = linkRowById.get(dec.linkId)
      if (!row) continue
      const od = row.org_decorations
      if (od.organization_id !== input.context.organizationId) continue
      if (!od.is_active) continue
      if (row.b2b_catalogue_items.source_product_id !== line.product_id) continue
      computedPairs.set(`${row.id}::${qty}`, { row, qty })
    }
  }

  // The tier multiplier depends only on the org — resolve it ONCE (it was
  // re-queried per decoration inside effectiveDecorationPrice), and only when
  // a computed decoration actually needs pricing.
  const tierMultiplier =
    computedPairs.size > 0
      ? await loadTierMultiplier(admin, input.context.organizationId)
      : 1

  const manualPriceByPair = new Map<string, number>()
  const computedPriceByPair = new Map<string, number>()
  await Promise.all([
    ...Array.from(manualPairs.entries()).map(async ([key, pair]) => {
      const { data: mc, error: mcErr } = await admin.rpc('catalogue_item_decoration_price', {
        p_catalogue_item_id: pair.itemId,
        p_qty: pair.qty,
      })
      const value = !mcErr && mc != null && Number.isFinite(Number(mc)) ? Number(mc) : 0
      manualPriceByPair.set(key, value)
    }),
    ...Array.from(computedPairs.entries()).map(async ([key, pair]) => {
      const od = pair.row.org_decorations
      const effective = await effectiveDecorationPrice(
        admin,
        {
          orgDecorationId: od.id,
          organizationId: input.context.organizationId,
          unitPriceOverride: pair.row.unit_price_override,
          baseUnitPrice: od.unit_price,
        },
        pair.qty,
        tierMultiplier,
      )
      computedPriceByPair.set(key, effective)
    }),
  ])

  function applyManualDecorationForLine(
    line: CheckoutLineInput,
    decorationQty: number,
    driftLinkId: string,
  ): void {
    if (!line.catalogueItemId) return
    const manualCombined =
      manualPriceByPair.get(`${line.catalogueItemId}::${decorationQty}`) ?? 0
    const serverR = Number(manualCombined.toFixed(2))
    const claimedR =
      line.claimed_manual_decoration == null
        ? null
        : Number(Number(line.claimed_manual_decoration).toFixed(2))
    if (claimedR != null && claimedR !== serverR) {
      drift.push({
        cartLineId: line.cart_line_id ?? null,
        productId: line.product_id,
        linkId: driftLinkId,
        decorationName: 'Decoration (combined)',
        was: claimedR,
        now: serverR,
        reason: 'price_drift',
      })
    } else {
      manualDecorationByLineKey.set(
        makeLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null),
        serverR,
      )
    }
  }

  for (const line of input.lines) {
    const decs = line.decorations ?? []
    const isManualLine = !!line.catalogueItemId && manualItemIds.has(line.catalogueItemId)
    if (decs.length === 0) {
      if (isManualLine) {
        applyManualDecorationForLine(line, decorationQtyForLine(line), '')
      }
      validatedByLineKey.set(makeLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null), [])
      continue
    }
    const byId = linkRowById
    const validated: CheckoutLineDecorationInput[] = []

    // Decoration tier qty for this line (aggregated across same product+signature
    // lines, mirroring the cart). Used for both the per-placement engine price
    // and the manual-final combined figure.
    const decorationQty = decorationQtyForLine(line)

    // Manual-final: when the line's catalogue item is manual, resolve the item's
    // ONE combined decoration figure from the engine (exact, no multiplier).
    // A NULL band => 0 decoration (the item has no decoration price at this qty);
    // we still treat the line as manual (keep per-placement VALIDATION, skip
    // per-placement pricing + drift, bill the combined at the line level).

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
      const art = pickOne(od.organization_artworks)

      // Manual-final: the placement stays on the order as metadata (real name +
      // artwork) but is NOT individually billed — unitPrice 0; the line's
      // combined figure (below) is the decoration cost. No per-placement drift.
      if (isManualLine) {
        validated.push({
          linkId: row.id,
          decorationId: od.id,
          name: od.name,
          method: od.decoration_method,
          positionLabel: loc?.location ?? null,
          unitPrice: 0,
          artworkUrl: art?.public_url ?? dec.artworkUrl,
          snapshotUrl: row.snapshot_url,
        })
        continue
      }

      const effective = computedPriceByPair.get(`${row.id}::${decorationQty}`) ?? 0
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

    // Manual-final: the SERVER combined is authoritative and always billed.
    // When the cart sent a claim, drift-check it (round 2dp then exact, per
    // Decision #3 — no tolerance) and BLOCK on mismatch so a stale/tampered cart
    // can't surprise the customer. When the claim is null/absent (unresolved PDP
    // fetch, reorder rebuild, legacy cart) we silently re-price from the engine —
    // mirrors the garment "legacy cart" path (UnitPriceDrift only guards carts
    // that carried a snapshot).
    if (isManualLine) {
      applyManualDecorationForLine(
        line,
        decorationQty,
        validated[0]?.linkId ?? decs[0]?.linkId ?? '',
      )
    }

    validatedByLineKey.set(makeLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null), validated)
    if (validated.length > 0) {
      const decoCatId = byId.get(validated[0].linkId)?.catalogue_item_id
      if (decoCatId) {
        decoCatalogueItemIdByLineKey.set(
          makeLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null),
          decoCatId,
        )
      }
    }
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
  // Index-aligned to `repriced` (and therefore to input.lines and
  // orderBillingLines, both .map over it). The billed-total snapshot below needs
  // the per-line figure; built in this same loop so it cannot disagree with the
  // running total.
  const decorationRevenueByLineIndex: number[] = []
  let totalDecorationRevenue = 0
  for (const l of repriced) {
    const lineKey = makeLineKey(l.product_id, l.variant_id ?? null, l.size_id ?? null)
    // Manual-final lines bill ONE combined figure (validated entries are $0
    // metadata); computed lines sum the per-placement prices.
    const manualDeco = manualDecorationByLineKey.get(lineKey)
    const validated = validatedByLineKey.get(lineKey) ?? []
    const perUnit =
      manualDeco != null ? manualDeco : validated.reduce((s, d) => s + d.unitPrice, 0)
    decorationCostByLineKey.set(lineKey, perUnit)
    const lineRevenue = perUnit * l.qty
    decorationRevenueByLineIndex.push(lineRevenue)
    totalDecorationRevenue += lineRevenue
  }

  // Phase 2 — drift signal only (we never throw): if a line's own catalogue
  // identity disagrees with the one its decoration links resolve to, log once
  // and trust the line's id (it is the authoritative line identity).
  let warnedCatalogueDrift = false

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
          `[submit_b2b_order] catalogue_item_id drift on line ` +
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
      }
    }),
    p_intent: input.intent ?? 'customer',
    p_member_permission: input.context.orderingPermission ?? 'both',
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
  const orderType = classifyOrderType(input.lines)
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
  // excluded here (region seam) pending the AUD/10%-GST AUS epic.
  //
  // `billingModeByVariant` is resolved once at step 2c, before the RPC — the
  // drift guard there has to be able to throw without stranding a committed
  // order, and one read serves this note, the Xero zeroing and the billed total.
  const orderBillingLines = input.lines.map((l) => ({
    stocked: l.fulfilment_type === 'stocked',
    billingMode: l.variant_id
      ? billingModeByVariant.get(l.variant_id) ?? 'invoice_on_dispatch'
      : ('invoice_on_dispatch' as BillingMode),
  }))
  const needsInvoicing = orderNeedsInvoicing(orderBillingLines)
  const isStockOnHandOrder = orderType === 'stock_on_hand'
  // Deco-inclusive: repriced.unit_price is garment-only (decoration is folded
  // into unit_price only inside the p_lines RPC payload), but the customer's
  // checkout estimate bands on allInUnitPrice (garment + decoration), so the
  // server must band on the same figure or the fee charged diverges from the
  // fee quoted at a $100/$200/$300/$400 boundary.
  const goodsSubtotal =
    repriced.reduce((t, l) => t + l.unit_price * l.qty, 0) + totalDecorationRevenue
  const pickFee = orderPickingFee({
    isStockOnHand: isStockOnHandOrder,
    shipCountry: (shippingAddress as { country?: unknown }).country as string | null | undefined,
    goodsSubtotal,
  })

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
  // which is why neither needs a submit_b2b_order change.
  const billedTotal = billedOrderTotal(
    orderBillingLines.map((billing, index) => ({
      stocked: billing.stocked,
      billingMode: billing.billingMode,
      goodsValue: repriced[index].unit_price * repriced[index].qty,
      decorationRevenue: decorationRevenueByLineIndex[index] ?? 0,
    })),
    pickFee,
  )
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
      },
    },
    admin,
  )

  // 4. Apply per-line ship_to_store_id, location label, and the decorations
  //    snapshot. The RPC creates quote_items without any of these; we set them
  //    here (submit_b2b_order unchanged) — see buildLineSnapshotUpdate.
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
  //     (location-manager feature, Option A 2026-07-27). submit_b2b_order never
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
        actorUserId: input.context.userId,
        ordererEmail: input.context.email ?? null,
        paymentTerms: input.context.paymentTerms ?? null,
        isTestOrg: xeroIsTestOrg,
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
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        intent: input.intent ?? 'customer',
        isTestOrg: ssIsTestOrg,
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
            metadata: { order_ref, reason: ssResult.reason },
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
    //    never break the order. Reuses the step-6 email summary + a portal deep
    //    link to the order's confirmation page (the only order_id-keyed route).
    try {
      const notifyOrderUrl = `${
        process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'
      }/checkout/confirmation/${order_id}`

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
          totalAmount: notifyTotal,
          orderUrl: notifyOrderUrl,
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
