import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillingCountryConfig } from '@/lib/account/org-countries'
import type {
  CheckoutInput,
  CheckoutLineDecorationInput,
  CheckoutLineInput,
} from '@/lib/checkout/submit'
import { effectiveDecorationPrice, loadTierMultiplier } from '@/lib/checkout/decoration-effective-price'
import {
  BillingModeDriftError,
  BuyerScopeError,
  DecorationDriftError,
  DisabledCountryError,
  CountryPriceUnavailableError,
  MemberAccessDriftError,
  MixedShippingAddressError,
  MoqViolationError,
  UnitPriceDriftError,
  type AccessDrift,
  type BillingModeDrift,
  type DecorationDrift,
  type MoqViolation,
  type UnitPriceDrift,
} from '@/lib/checkout/errors'
import { getGrantedCatalogueItemIds } from '@/lib/shop/member-access'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'
import { getEffectiveMoq } from '@/lib/shop/effective-moq'
import { effectiveUnitPriceForItem } from '@/lib/shop/effective-price'
import { classifyOrderType } from '@/lib/orders/order-type'
import {
  getOpenPeriodForOrg,
  getPreOrderItemIds,
  type OpenPeriod,
} from '@/lib/pricing/period-brackets'
import { orderNeedsInvoicing } from '@/lib/checkout/order-billing'
import { resolveLineBillingModes } from '@/lib/checkout/resolve-line-billing-modes'
import { checkoutPickingFee } from '@/lib/pricing/order-picking-fee'
import { round2 } from '@/lib/pricing/pricingMath'
import { isPrepaidDrawn } from '@/lib/shop/prepaid-tag'
import type { BillingMode } from '@/lib/shop/billing-mode'
import {
  garmentBandQty,
  isPoolingLine,
  pooledDecorationQty,
  pooledQtyByDecoration,
  type PoolingLine,
} from '@/lib/pricing/decoration-pooling'
import { formatShippingAddress, isoCountryOrNull } from '@/lib/checkout/shipping-address'

export interface PreparedCheckoutLine extends CheckoutLineInput {
  cartLineId: string | null
  unitPrice: number
  decorationUnitPrice: number
  billingMode: BillingMode
  billed: boolean
  repricedFromCurrency?: string
}

export interface PreparedCheckoutPartition {
  key: string
  country: BillingCountryConfig
  orderType: 'purchase_order' | 'stock_on_hand'
  lines: PreparedCheckoutLine[]
  pricingPoolLines: CheckoutLineInput[]
  totals: {
    goodsSubtotal: number
    decorationSubtotal: number
    pickingFee: number
    tax: number
    total: number
  }
}

export interface PrepareCustomerOrderOptions {
  countryPartitionEnabled: boolean
  partitionKey: string
  country: BillingCountryConfig
}

export interface BilledTotalLine {
  stocked: boolean
  billingMode: BillingMode
  goodsValue: number
  decorationRevenue: number
}

export function billedOrderTotal(lines: BilledTotalLine[], pickFee: number): number {
  const billedGoods = lines.reduce((total, line) => {
    if (isPrepaidDrawn(line.stocked ? 'stocked' : 'made_to_order', line.billingMode)) {
      return total
    }
    return total + line.goodsValue + line.decorationRevenue
  }, 0)
  return round2(billedGoods + pickFee)
}

export function garmentUnitPriceForLine(
  line: Pick<CheckoutLineInput, 'fulfilment_type' | 'catalogueItemId'>,
  ladderUnitPrice: number,
  stockUnitPriceByItem: Map<string, number>,
): number {
  if (line.fulfilment_type === 'stocked' && line.catalogueItemId) {
    const explicit = stockUnitPriceByItem.get(line.catalogueItemId)
    if (explicit != null) return explicit
  }
  return ladderUnitPrice
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

export interface PreparedCheckoutInternals {
  shipToStoreIds: Array<string | null>
  shippingAddress: Record<string, unknown>
  formattedShippingAddress: string | null
  repriced: Array<CheckoutLineInput & { unit_price: number }>
  validatedByLineKey: Map<string, CheckoutLineDecorationInput[]>
  decoCatalogueItemIdByLineKey: Map<string, string>
  decorationCostByLineKey: Map<string, number>
  decorationRevenueByLineIndex: number[]
  totalDecorationRevenue: number
  billingModeByVariant: Map<string, BillingMode>
  orderType: 'purchase_order' | 'stock_on_hand'
  orderBillingLines: Array<{ stocked: boolean; billingMode: BillingMode }>
  needsInvoicing: boolean
  goodsValueForBand: number
  orgRegion: 'NZ' | 'AU'
  pickFee: number
  billedTotal: number
  openPeriod: OpenPeriod | null
  preOrderItemIds: Set<string>
}

const preparedInternals = new WeakMap<PreparedCheckoutPartition, PreparedCheckoutInternals>()

export function preparedCheckoutInternalsFor(
  prepared: PreparedCheckoutPartition,
): PreparedCheckoutInternals {
  const internals = preparedInternals.get(prepared)
  if (!internals) throw new Error('Prepared checkout internals are unavailable')
  return internals
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export function preparedLineKey(
  productId: string,
  variantId: string | null,
  sizeId: number | null = null,
): string {
  return `${productId}::${variantId ?? ''}::${sizeId ?? ''}`
}

function decorationAggregationSignature(
  decorations: CheckoutLineDecorationInput[] | undefined,
): string {
  return !decorations || decorations.length === 0
    ? ''
    : decorations
        .map((decoration) => decoration.decorationId)
        .slice()
        .sort()
        .join('|')
}

export function tierAggregationKey(
  productId: string,
  decorations: CheckoutLineDecorationInput[] | undefined,
): string {
  return `${productId}::${decorationAggregationSignature(decorations)}`
}

function garmentPriceAggregationKey(line: CheckoutLineInput): string {
  const itemOrProduct = line.catalogueItemId
    ? `item:${line.catalogueItemId}`
    : `product:${line.product_id}`
  return `${itemOrProduct}::${decorationAggregationSignature(line.decorations)}`
}

function garmentPriceKey(line: CheckoutLineInput, bandQty: number): string {
  return `${garmentPriceAggregationKey(line)}::q${bandQty}`
}

async function loadPoolableDecorationIds(
  admin: SupabaseClient,
  lines: readonly CheckoutLineInput[],
  organizationId: string,
): Promise<Set<string>> {
  const ids = Array.from(
    new Set(
      lines
        .flatMap((line) => (line.decorations ?? []).map((decoration) => decoration.decorationId))
        .filter(Boolean),
    ),
  )
  const poolable = new Set<string>()
  if (ids.length === 0) return poolable

  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await admin
      .from('org_decorations')
      .select('id, artwork_id, decoration_method, organization_id')
      .in('id', ids.slice(index, index + 100))
    if (error) return new Set()
    for (const row of (data ?? []) as Array<{
      id: string
      artwork_id: string | null
      decoration_method: string | null
      organization_id: string
    }>) {
      if (
        row.organization_id === organizationId &&
        row.artwork_id != null &&
        row.decoration_method !== 'custom'
      ) {
        poolable.add(row.id)
      }
    }
  }
  return poolable
}

export async function prepareCustomerOrderPartition(
  admin: SupabaseClient,
  input: CheckoutInput,
  options: PrepareCustomerOrderOptions,
): Promise<PreparedCheckoutPartition> {
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

  // SP1 address hard floor: a one-time address must name a country the org has
  // enabled. Store-bound lines need no check here — stores.country is FK-bound
  // to enabled countries at write time.
  if (input.custom_shipping_address) {
    const raw = (input.custom_shipping_address as Record<string, unknown>).country
    const iso = isoCountryOrNull(typeof raw === 'string' ? raw : null)
    const { data: enabledRows } = await admin
      .from('organization_countries')
      .select('country_code')
      .eq('organization_id', input.context.organizationId)
    const enabled = new Set((enabledRows ?? []).map((r) => r.country_code as string))
    if (!iso || !enabled.has(iso)) {
      throw new DisabledCountryError(typeof raw === 'string' ? raw : '')
    }
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
    if (options.countryPartitionEnabled) {
      const partitionStoreIds = Array.from(
        new Set(input.lines.map((line) => line.ship_to_store_id).filter(Boolean)),
      ) as string[]
      const { data: partitionStores, error: partitionStoresError } = await admin
        .from('stores')
        .select('id, name, address, city, state, country, postal_code')
        .in('id', partitionStoreIds)
      if (partitionStoresError) {
        throw new Error(`Checkout partition store lookup failed: ${partitionStoresError.message}`)
      }
      const storesById = new Map(
        ((partitionStores ?? []) as Array<Record<string, unknown>>).map((store) => [
          store.id as string,
          store,
        ]),
      )
      for (const storeId of partitionStoreIds) {
        const store = storesById.get(storeId)
        if (store?.country !== options.country.code) {
          throw new Error('Checkout partition country mismatch')
        }
      }
      const firstStore = storesById.get(input.lines[0].ship_to_store_id)
      if (firstStore) shippingAddress = firstStore
    } else {
      const { data: firstStore } = await admin
        .from('stores')
        .select('id, name, address, city, state, country, postal_code')
        .eq('id', input.lines[0].ship_to_store_id)
        .single()
      if (firstStore) shippingAddress = firstStore as unknown as Record<string, unknown>
    }
  }
  const formattedShippingAddress = formatShippingAddress(shippingAddress)

  // 1b. Per-member access re-verify. Mid-flight: if staff revoked a catalogue
  //     or item grant between cart load and checkout, we MUST reject before
  //     the submit RPC touches anything.
  const grantedItemIds = new Set(
    await getGrantedCatalogueItemIds(
      admin,
      input.context.membershipId,
      input.context.organizationId,
    ),
  )
  if (grantedItemIds.size > 0) {
    // Map each line.product_id to a catalogue_item the member can still see.
    // The submit RPC keys on product_id (matching /shop/[productId]), so it's
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
  // The submit RPC resolves fulfilment the same way
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

  // ── Pooled decoration pricing (spec 2026-08-13) ──────────────────────────
  // Resolved here, above the garment price loop, because the per-catalogue flag
  // decides that loop's band quantity. This is the SAME once-per-checkout
  // b2b_catalogue_items read that already resolves price_mode for manual-final
  // lines (it used to sit further down) — widened with catalogue_id + the flag,
  // and widened to poolLines so a partitioned submit still sees the whole cart's
  // items. Extra rows are inert: isManualCheckoutLine only ever asks about this
  // partition's own lines.
  const catalogueItemIdsForPricing = Array.from(
    new Set(
      [...input.lines, ...poolLines]
        .map((l) => l.catalogueItemId)
        .filter((x): x is string => !!x),
    ),
  )
  const manualItemIds = new Set<string>()
  const catalogueIdByItemId = new Map<string, string>()
  const poolingEnabledItemIds = new Set<string>()
  if (catalogueItemIdsForPricing.length > 0) {
    const { data: pmRows } = await admin
      .from('b2b_catalogue_items')
      .select('id, price_mode, catalogue_id, b2b_catalogues(decoration_pooling_enabled)')
      .in('id', catalogueItemIdsForPricing)
    for (const r of (pmRows ?? []) as Array<{
      id: string
      price_mode: string | null
      catalogue_id?: string | null
      b2b_catalogues?:
        | { decoration_pooling_enabled?: boolean | null }
        | { decoration_pooling_enabled?: boolean | null }[]
        | null
    }>) {
      if (r.price_mode === 'manual_final') manualItemIds.add(r.id)
      if (r.catalogue_id) catalogueIdByItemId.set(r.id, r.catalogue_id)
      const cat = Array.isArray(r.b2b_catalogues) ? r.b2b_catalogues[0] : r.b2b_catalogues
      if (cat?.decoration_pooling_enabled === true) poolingEnabledItemIds.add(r.id)
    }
  }

  // With every catalogue's flag false — the default and the ship-time state —
  // this is false and every pooled branch below is skipped entirely, including
  // the decoration read. Flag-off costs exactly one widened select and nothing else.
  const poolingActive = poolingEnabledItemIds.size > 0
  const poolableDecorationIds = poolingActive
    ? await loadPoolableDecorationIds(admin, poolLines, input.context.organizationId)
    : new Set<string>()

  /** Checkout's snake_case line adapted to the shared module's shape. */
  const toPoolingLine = (l: CheckoutLineInput): PoolingLine => ({
    catalogueId: l.catalogueItemId
      ? catalogueIdByItemId.get(l.catalogueItemId) ?? null
      : null,
    poolingEnabled: !!l.catalogueItemId && poolingEnabledItemIds.has(l.catalogueItemId),
    qty: l.qty,
    fulfilmentType: l.fulfilment_type ?? null,
    decorations: (l.decorations ?? []).map((d) => ({
      decorationId: d.decorationId,
      poolable: poolableDecorationIds.has(d.decorationId),
    })),
  })

  // Seeded from poolLines — the FULL unpartitioned cart on every partition's
  // submit call — so the shared module's stocked-line filter is load-bearing here,
  // not incidental.
  const poolQtyByDecorationId = poolingActive
    ? pooledQtyByDecoration(poolLines.map(toPoolingLine))
    : new Map<string, number>()

  // Two passes, mirroring the cart: today's group totals first, then each line's
  // band quantity from them. `totalQty` stays the REAL, un-inflated group total —
  // it is what ordering-period pricing keeps reading. `bandQty` is the pooled
  // max-rule quantity and is only ever an RPC qty argument.
  const totalQtyByGarmentKey = new Map<string, number>()
  for (const line of poolLines) {
    const k = garmentPriceAggregationKey(line)
    totalQtyByGarmentKey.set(k, (totalQtyByGarmentKey.get(k) ?? 0) + line.qty)
  }
  const garmentBandQtyForLine = (line: CheckoutLineInput): number => {
    const own = totalQtyByGarmentKey.get(garmentPriceAggregationKey(line)) ?? line.qty
    if (!poolingActive) return own
    return garmentBandQty(toPoolingLine(line), poolQtyByDecorationId, own)
  }

  const garmentPriceGroups = new Map<
    string,
    {
      productId: string
      catalogueItemId: string | null
      totalQty: number
      bandQty: number
      line: CheckoutLineInput
    }
  >()
  const garmentLinesToPrice = options.countryPartitionEnabled ? input.lines : poolLines
  for (const line of garmentLinesToPrice) {
    const bandQty = garmentBandQtyForLine(line)
    const k = garmentPriceKey(line, bandQty)
    if (garmentPriceGroups.has(k)) continue
    garmentPriceGroups.set(k, {
      productId: line.product_id,
      catalogueItemId: line.catalogueItemId ?? null,
      totalQty: totalQtyByGarmentKey.get(garmentPriceAggregationKey(line)) ?? line.qty,
      bandQty,
      line,
    })
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
        // Ordering-period pricing is spec-excluded from pooling (§5): periods
        // pool per-item across orders on their own frozen-price system. It keeps
        // the REAL group quantity, never the pooled band quantity.
        const { data: unit, error } = options.countryPartitionEnabled
          ? await admin.rpc('period_unit_price_for_currency', {
              p_period_id: openPeriod.id,
              p_catalogue_item_id: group.catalogueItemId,
              p_qty: group.totalQty,
              p_currency: options.country.currency,
            })
          : await admin.rpc('period_unit_price', {
              p_period_id: openPeriod.id,
              p_catalogue_item_id: group.catalogueItemId,
              p_qty: group.totalQty,
            })
        if (
          options.countryPartitionEnabled &&
          (error || unit == null || !Number.isFinite(Number(unit)))
        ) {
          throw new CountryPriceUnavailableError({
            cartLineId: group.line.cart_line_id ?? null,
            productId: group.line.product_id,
            productName: group.line.product_name,
            countryCode: options.country.code,
            currency: options.country.currency,
            component: 'period',
          })
        }
        garmentPriceByKey.set(priceKey, Number(unit ?? 0))
        return
      }

      if (group.catalogueItemId) {
        const unit = await effectiveUnitPriceForItem(
          admin,
          group.catalogueItemId,
          input.context.organizationId,
          group.bandQty,
          options.country.currency,
          options.countryPartitionEnabled,
        )
        if (options.countryPartitionEnabled && unit == null) {
          throw new CountryPriceUnavailableError({
            cartLineId: group.line.cart_line_id ?? null,
            productId: group.line.product_id,
            productName: group.line.product_name,
            countryCode: options.country.code,
            currency: options.country.currency,
            component: 'garment',
          })
        }
        garmentPriceByKey.set(priceKey, unit ?? 0)
        return
      }

      if (options.countryPartitionEnabled) {
        throw new CountryPriceUnavailableError({
          cartLineId: group.line.cart_line_id ?? null,
          productId: group.line.product_id,
          productName: group.line.product_name,
          countryCode: options.country.code,
          currency: options.country.currency,
          component: 'garment',
        })
      }

      // Legacy product-keyed lines carry no catalogueItemId, so they can never
      // resolve a pooled catalogue and bandQty always equals totalQty here.
      const { data: unit } = await admin.rpc('effective_unit_price', {
        p_product_id: group.productId,
        p_org_id: input.context.organizationId,
        p_qty: group.bandQty,
      })
      garmentPriceByKey.set(priceKey, Number(unit ?? 0))
    }),
  )

  // Explicit stock sell prices for the cart's stocked catalogue items. A stock
  // draw on an item with stock_unit_price set charges that flat price (not the
  // ladder) — matching the PDP's claimed price so the drift guard below passes.
  const stockDrawItemIds = Array.from(
    new Set(
      input.lines
        .filter((l) => l.fulfilment_type === 'stocked' && l.catalogueItemId)
        .map((l) => l.catalogueItemId as string),
    ),
  )
  const stockUnitPriceByItem = new Map<string, number>()
  if (stockDrawItemIds.length > 0) {
    const { data: stockPriceRows } = await admin
      .from('b2b_catalogue_items')
      .select('id, stock_unit_price')
      .in('id', stockDrawItemIds)
    const rows = (stockPriceRows ?? []) as Array<{
      id: string
      stock_unit_price: number | string | null
    }>
    if (options.countryPartitionEnabled) {
      await Promise.all(
        stockDrawItemIds.map(async (catalogueItemId) => {
          const { data, error } = await admin.rpc(
            'catalogue_stock_unit_price_for_currency',
            {
              p_catalogue_item_id: catalogueItemId,
              p_currency: options.country.currency,
            },
          )
          const exact = data == null ? null : Number(data)
          if (!error && exact != null && Number.isFinite(exact)) {
            stockUnitPriceByItem.set(catalogueItemId, exact)
            return
          }
          const legacyScalarExists = rows.some(
            (row) => row.id === catalogueItemId && row.stock_unit_price != null,
          )
          if (!legacyScalarExists) return
          const line = input.lines.find(
            (candidate) => candidate.catalogueItemId === catalogueItemId,
          )!
          throw new CountryPriceUnavailableError({
            cartLineId: line.cart_line_id ?? null,
            productId: line.product_id,
            productName: line.product_name,
            countryCode: options.country.code,
            currency: options.country.currency,
            component: 'stock',
          })
        }),
      )
    } else {
      for (const r of rows) {
        if (r.stock_unit_price != null) {
          stockUnitPriceByItem.set(r.id, Number(r.stock_unit_price))
        }
      }
    }
  }

  const repriced = input.lines.map(l => ({
    ...l,
    unit_price: garmentUnitPriceForLine(
      l,
      garmentPriceByKey.get(garmentPriceKey(l, garmentBandQtyForLine(l))) ?? 0,
      stockUnitPriceByItem,
    ),
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
    const claimed = options.countryPartitionEnabled
      ? line.reviewed_currency === options.country.currency
        ? line.reviewed_unit_price
        : undefined
      : line.has_brackets
        ? line.claimed_unit_price
        : undefined
    if (typeof claimed !== 'number') continue
    const canonical = garmentUnitPriceForLine(
      line,
      garmentPriceByKey.get(garmentPriceKey(line, garmentBandQtyForLine(line))) ?? 0,
      stockUnitPriceByItem,
    )
    if (Math.abs(claimed - canonical) > PRICE_DRIFT_TOLERANCE) {
      unitPriceDrift.push({
        cartLineId: line.cart_line_id ?? null,
        productId: line.product_id,
        productName: line.product_name,
        qty: line.qty,
        claimedUnitPrice: claimed,
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
  // (manualItemIds is resolved above, in the same widened b2b_catalogue_items
  // read that resolves each line's catalogue id and pooling flag.)

  type ResolvedCheckoutRendition = {
    product_variant_id: string
    link_id: string
    org_decoration_id: string
    rendition_id: string
    rendition_label: string
    artwork_id: string
    artwork_name: string
    artwork_url: string
    artwork_storage_path: string
    artwork_sha256: string | null
    snapshot_url: string | null
    resolution_source: 'exact_variant' | 'decoration_default'
    resolution_token: string
  }

  // Resolve production files from the current exact colourway assignment. The
  // cart's rendition fields are display snapshots only; checkout never trusts
  // them to choose what production prints. Grouping by item keeps this one RPC
  // per catalogue item, even when the cart has many sizes/lines.
  const variantIdsByItem = new Map<string, Set<string>>()
  for (const line of input.lines) {
    if (!line.catalogueItemId || !line.variant_id || !(line.decorations?.length)) continue
    const ids = variantIdsByItem.get(line.catalogueItemId) ?? new Set<string>()
    ids.add(line.variant_id)
    variantIdsByItem.set(line.catalogueItemId, ids)
  }
  const resolvedRenditionByKey = new Map<string, ResolvedCheckoutRendition>()
  await Promise.all(
    Array.from(variantIdsByItem.entries()).map(async ([itemId, variantIds]) => {
      const { data, error } = await admin.rpc('resolve_catalogue_decoration_renditions', {
        p_catalogue_item_id: itemId,
        p_product_variant_ids: Array.from(variantIds),
      })
      if (error) {
        throw new Error(`decoration rendition lookup failed: ${error.message}`)
      }
      if (!Array.isArray(data)) return
      for (const row of data as ResolvedCheckoutRendition[]) {
        resolvedRenditionByKey.set(
          `${itemId}::${row.product_variant_id}::${row.org_decoration_id}`,
          row,
        )
      }
    }),
  )

  const resolvedRenditionFor = (
    line: CheckoutLineInput,
    decorationId: string,
  ): ResolvedCheckoutRendition | null =>
    line.catalogueItemId && line.variant_id
      ? resolvedRenditionByKey.get(
          `${line.catalogueItemId}::${line.variant_id}::${decorationId}`,
        ) ?? null
      : null

  type LinkRow = {
    id: string
    catalogue_item_id: string
    unit_price_override: number | string | null
    snapshot_url: string | null
    b2b_catalogue_items: { id: string; source_product_id: string }
    org_decorations: {
      id: string
      artwork_id: string | null
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
          artwork_id,
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

  /**
   * The band quantity ONE decoration of ONE line prices at. Each placement reads
   * its own pool, so a garment carrying an extra back print picks that print's
   * smaller band independently — the spec's "sequential difference added on".
   */
  const decorationQtyFor = (line: CheckoutLineInput, decorationId: string): number => {
    const fallback = decorationQtyForLine(line)
    if (!poolingActive) return fallback
    return pooledDecorationQty(
      toPoolingLine(line),
      { decorationId, poolable: poolableDecorationIds.has(decorationId) },
      poolQtyByDecorationId,
      fallback,
    )
  }

  const isPooledLine = (line: CheckoutLineInput): boolean =>
    poolingActive && isPoolingLine(toPoolingLine(line))

  const isManualCheckoutLine = (line: CheckoutLineInput): boolean =>
    !!line.catalogueItemId && manualItemIds.has(line.catalogueItemId)

  /**
   * Manual-final items in a POOLED catalogue stop using the item's combined
   * per-band decoration figure: one number per garment cannot express a
   * per-placement delta, which is exactly why pooling moves decoration price onto
   * per-decoration ladders (spec §3). Those lines take the per-placement path
   * instead — Sigma effective_decoration_unit_price at each placement's pooled qty —
   * matching what the cart claims for them.
   */
  const isCombinedManualLine = (line: CheckoutLineInput): boolean =>
    isManualCheckoutLine(line) && !isPooledLine(line)

  // Pre-resolve every decoration price this order needs, concurrently and
  // deduplicated: manual lines need ONE combined figure per distinct
  // (catalogue item, pooled qty); computed decorations need one engine price
  // per distinct (link, pooled qty). Only structurally-valid rows are priced —
  // rejected placements (detached/cross-org/inactive/wrong-item) never were.
  const manualPairs = new Map<
    string,
    { itemId: string; qty: number; line: CheckoutLineInput }
  >()
  const computedPairs = new Map<
    string,
    { row: LinkRow; qty: number; line: CheckoutLineInput }
  >()
  for (const line of input.lines) {
    if (isCombinedManualLine(line) && line.catalogueItemId) {
      const qty = decorationQtyForLine(line)
      manualPairs.set(`${line.catalogueItemId}::${qty}`, {
        itemId: line.catalogueItemId,
        qty,
        line,
      })
      continue
    }
    for (const dec of line.decorations ?? []) {
      const row = linkRowById.get(dec.linkId)
      if (!row) continue
      const od = row.org_decorations
      if (od.organization_id !== input.context.organizationId) continue
      if (!od.is_active) continue
      if (row.b2b_catalogue_items.source_product_id !== line.product_id) continue
      const qty = decorationQtyFor(line, od.id)
      computedPairs.set(`${row.id}::${qty}`, { row, qty, line })
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
      const { data: mc, error: mcErr } = options.countryPartitionEnabled
        ? await admin.rpc('catalogue_item_decoration_price_for_currency', {
            p_catalogue_item_id: pair.itemId,
            p_qty: pair.qty,
            p_currency: options.country.currency,
          })
        : await admin.rpc('catalogue_item_decoration_price', {
            p_catalogue_item_id: pair.itemId,
            p_qty: pair.qty,
          })
      if (
        options.countryPartitionEnabled &&
        (mcErr || mc == null || !Number.isFinite(Number(mc)))
      ) {
        throw new CountryPriceUnavailableError({
          cartLineId: pair.line.cart_line_id ?? null,
          productId: pair.line.product_id,
          productName: pair.line.product_name,
          countryCode: options.country.code,
          currency: options.country.currency,
          component: 'decoration',
        })
      }
      const value = !mcErr && mc != null && Number.isFinite(Number(mc)) ? Number(mc) : 0
      manualPriceByPair.set(key, value)
    }),
    ...Array.from(computedPairs.entries()).map(async ([key, pair]) => {
      const od = pair.row.org_decorations
      const priceInput = {
        orgDecorationId: od.id,
        organizationId: input.context.organizationId,
        unitPriceOverride: pair.row.unit_price_override,
        baseUnitPrice: od.unit_price,
      }
      const effective = options.countryPartitionEnabled
        ? await effectiveDecorationPrice(
            admin,
            priceInput,
            pair.qty,
            tierMultiplier,
            {
              countryPartitionEnabled: true,
              targetCurrency: options.country.currency,
            },
          )
        : await effectiveDecorationPrice(
            admin,
            priceInput,
            pair.qty,
            tierMultiplier,
          )
      if (options.countryPartitionEnabled && effective == null) {
        throw new CountryPriceUnavailableError({
          cartLineId: pair.line.cart_line_id ?? null,
          productId: pair.line.product_id,
          productName: pair.line.product_name,
          countryCode: options.country.code,
          currency: options.country.currency,
          component: 'decoration',
        })
      }
      computedPriceByPair.set(key, effective ?? 0)
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
      options.countryPartitionEnabled || line.claimed_manual_decoration == null
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
        preparedLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null),
        serverR,
      )
    }
  }

  for (const line of input.lines) {
    const decs = line.decorations ?? []
    // Pooled manual items take the per-placement path (see isCombinedManualLine).
    const isManualLine = isCombinedManualLine(line)
    if (decs.length === 0) {
      if (isManualLine) {
        applyManualDecorationForLine(line, decorationQtyForLine(line), '')
      }
      validatedByLineKey.set(preparedLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null), [])
      continue
    }
    const byId = linkRowById
    const validated: CheckoutLineDecorationInput[] = []

    // Line-level decoration tier qty (aggregated across same product+signature
    // lines, mirroring the cart). Still the qty for the manual-final combined
    // figure; per-placement prices now resolve their OWN pooled qty via
    // decorationQtyFor, since two placements on one garment can sit in different
    // bands when their artworks appear on different numbers of garments.
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
      const rendition = resolvedRenditionFor(line, od.id)
      if (line.catalogueItemId && line.variant_id && od.artwork_id && !rendition) {
        throw new Error(
          `No active artwork rendition is available for ${od.name} on variant ${line.variant_id}.`,
        )
      }

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
          artworkUrl: rendition?.artwork_url ?? art?.public_url ?? dec.artworkUrl,
          snapshotUrl: rendition ? rendition.snapshot_url : row.snapshot_url,
          renditionId: rendition?.rendition_id ?? dec.renditionId ?? null,
          renditionLabel: rendition?.rendition_label ?? dec.renditionLabel ?? null,
          artworkId: rendition?.artwork_id ?? dec.artworkId ?? null,
          artworkName: rendition?.artwork_name ?? dec.artworkName ?? null,
          renditionArtworkStoragePath:
            rendition?.artwork_storage_path ?? dec.renditionArtworkStoragePath ?? null,
          renditionArtworkSha256:
            rendition?.artwork_sha256 ?? dec.renditionArtworkSha256 ?? null,
          renditionProductVariantId:
            rendition?.product_variant_id ?? dec.renditionProductVariantId ?? null,
          renditionResolutionToken:
            rendition?.resolution_token ?? dec.renditionResolutionToken ?? null,
          renditionResolutionSource:
            rendition?.resolution_source ?? dec.renditionResolutionSource ?? 'legacy_default',
        })
        continue
      }

      const effective =
        computedPriceByPair.get(`${row.id}::${decorationQtyFor(line, od.id)}`) ?? 0
      if (!options.countryPartitionEnabled && effective !== dec.unitPrice) {
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
        artworkUrl: rendition?.artwork_url ?? art?.public_url ?? dec.artworkUrl,
        snapshotUrl: rendition ? rendition.snapshot_url : row.snapshot_url,
        renditionId: rendition?.rendition_id ?? dec.renditionId ?? null,
        renditionLabel: rendition?.rendition_label ?? dec.renditionLabel ?? null,
        artworkId: rendition?.artwork_id ?? dec.artworkId ?? null,
        artworkName: rendition?.artwork_name ?? dec.artworkName ?? null,
        renditionArtworkStoragePath:
          rendition?.artwork_storage_path ?? dec.renditionArtworkStoragePath ?? null,
        renditionArtworkSha256:
          rendition?.artwork_sha256 ?? dec.renditionArtworkSha256 ?? null,
        renditionProductVariantId:
          rendition?.product_variant_id ?? dec.renditionProductVariantId ?? null,
        renditionResolutionToken:
          rendition?.resolution_token ?? dec.renditionResolutionToken ?? null,
        renditionResolutionSource:
          rendition?.resolution_source ?? dec.renditionResolutionSource ?? 'legacy_default',
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

    validatedByLineKey.set(preparedLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null), validated)
    if (validated.length > 0) {
      const decoCatId = byId.get(validated[0].linkId)?.catalogue_item_id
      if (decoCatId) {
        decoCatalogueItemIdByLineKey.set(
          preparedLineKey(line.product_id, line.variant_id ?? null, line.size_id ?? null),
          decoCatId,
        )
      }
    }
  }

  if (drift.length > 0) {
    throw new DecorationDriftError(drift)
  }

  const decorationCostByLineKey = new Map<string, number>()
  const decorationRevenueByLineIndex: number[] = []
  let totalDecorationRevenue = 0
  for (const line of repriced) {
    const lineKey = preparedLineKey(
      line.product_id,
      line.variant_id ?? null,
      line.size_id ?? null,
    )
    const manualDecoration = manualDecorationByLineKey.get(lineKey)
    const validated = validatedByLineKey.get(lineKey) ?? []
    const perUnit =
      manualDecoration != null
        ? manualDecoration
        : validated.reduce((sum, decoration) => sum + decoration.unitPrice, 0)
    decorationCostByLineKey.set(lineKey, perUnit)
    if (
      options.countryPartitionEnabled &&
      line.reviewed_currency === options.country.currency &&
      typeof line.reviewed_decoration_price === 'number'
    ) {
      const reviewed = Number(line.reviewed_decoration_price.toFixed(2))
      const canonical = Number(perUnit.toFixed(2))
      if (reviewed !== canonical) {
        drift.push({
          cartLineId: line.cart_line_id ?? null,
          productId: line.product_id,
          linkId: line.decorations?.[0]?.linkId ?? '',
          decorationName: 'Decoration (combined)',
          was: reviewed,
          now: canonical,
          reason: 'price_drift',
        })
      }
    }
    const lineRevenue = perUnit * line.qty
    decorationRevenueByLineIndex.push(lineRevenue)
    totalDecorationRevenue += lineRevenue
  }
  if (drift.length > 0) {
    throw new DecorationDriftError(drift)
  }

  const orderType = classifyOrderType(input.lines)
  const orderBillingLines = input.lines.map((line) => ({
    stocked: line.fulfilment_type === 'stocked',
    billingMode: line.variant_id
      ? billingModeByVariant.get(line.variant_id) ?? 'invoice_on_dispatch'
      : ('invoice_on_dispatch' as BillingMode),
  }))
  const needsInvoicing = orderNeedsInvoicing(orderBillingLines)
  const garmentSubtotal = round2(
    repriced.reduce((total, line) => total + line.unit_price * line.qty, 0),
  )
  const goodsValueForBand = round2(garmentSubtotal + totalDecorationRevenue)
  let orgRegion: 'NZ' | 'AU' = 'NZ'
  if (!options.countryPartitionEnabled) {
    const { data: orgRegionRow } = await admin
      .from('organizations')
      .select('region')
      .eq('id', input.context.organizationId)
      .maybeSingle()
    orgRegion =
      (orgRegionRow as { region?: string | null } | null)?.region === 'AU' ? 'AU' : 'NZ'
  }
  const pickFee = checkoutPickingFee({
    countryPartitionEnabled: options.countryPartitionEnabled,
    orderType,
    billCountry: options.country.code,
    goodsSubtotal: goodsValueForBand,
    legacyShipCountry: (shippingAddress as { country?: unknown }).country as
      | string
      | null
      | undefined,
    legacyOrgRegion: orgRegion,
  })

  let billedGoodsSubtotal = 0
  let billedDecorationSubtotal = 0
  for (const [index, line] of repriced.entries()) {
    const billing = orderBillingLines[index]
    if (isPrepaidDrawn(line.fulfilment_type, billing.billingMode)) continue
    billedGoodsSubtotal = round2(billedGoodsSubtotal + line.unit_price * line.qty)
    billedDecorationSubtotal = round2(
      billedDecorationSubtotal + (decorationRevenueByLineIndex[index] ?? 0),
    )
  }
  const billedTotal = billedOrderTotal(
    orderBillingLines.map((billing, index) => ({
      stocked: billing.stocked,
      billingMode: billing.billingMode,
      goodsValue: repriced[index].unit_price * repriced[index].qty,
      decorationRevenue: decorationRevenueByLineIndex[index] ?? 0,
    })),
    pickFee,
  )
  const tax = round2(billedTotal * options.country.taxRate)
  const prepared: PreparedCheckoutPartition = {
    key: options.partitionKey,
    country: options.country,
    orderType,
    lines: repriced.map((line, index) => {
      const decorationUnitPrice =
        decorationCostByLineKey.get(
          preparedLineKey(
            line.product_id,
            line.variant_id ?? null,
            line.size_id ?? null,
          ),
        ) ?? 0
      const billingMode = orderBillingLines[index].billingMode
      return {
        ...line,
        cartLineId: line.cart_line_id ?? null,
        unitPrice: line.unit_price,
        decorationUnitPrice,
        billingMode,
        billed: !isPrepaidDrawn(line.fulfilment_type, billingMode),
        ...(options.countryPartitionEnabled &&
        line.priceCurrency &&
        line.priceCurrency !== options.country.currency
          ? { repricedFromCurrency: line.priceCurrency }
          : {}),
      }
    }),
    pricingPoolLines: input.pricing_pool_lines ?? input.lines,
    totals: {
      goodsSubtotal: billedGoodsSubtotal,
      decorationSubtotal: billedDecorationSubtotal,
      pickingFee: round2(pickFee),
      tax,
      total: round2(billedTotal + tax),
    },
  }
  preparedInternals.set(prepared, {
    shipToStoreIds,
    shippingAddress,
    formattedShippingAddress,
    repriced,
    validatedByLineKey,
    decoCatalogueItemIdByLineKey,
    decorationCostByLineKey,
    decorationRevenueByLineIndex,
    totalDecorationRevenue,
    billingModeByVariant,
    orderType,
    orderBillingLines,
    needsInvoicing,
    goodsValueForBand,
    orgRegion,
    pickFee,
    billedTotal,
    openPeriod,
    preOrderItemIds,
  })
  return prepared
}
