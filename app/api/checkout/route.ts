import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import {
  BillingModeDriftError,
  BuyerScopeError,
  DecorationDriftError,
  MemberAccessDriftError,
  MixedShippingAddressError,
  MoqViolationError,
  StockShortfallError,
  UnitPriceDriftError,
  submitCustomerOrder,
  type CheckoutLineInput,
} from '@/lib/checkout/submit'
import { cacheTags } from '@/lib/cache/tags'
import { partitionCheckoutLines, type CheckoutOrderType } from '@/lib/checkout/partition'

interface CheckoutRequestBody {
  idempotency_key?: string
  required_by?: string | null
  notes?: string | null
  /** Slice 4: 'inventory' routes the order into the org's stock shelf instead of a customer delivery. */
  intent?: 'customer' | 'inventory'
  lines?: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
}

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi({ requireCustomerCode: true })
  if ('error' in auth) return auth.error

  let body: CheckoutRequestBody
  try {
    body = (await request.json()) as CheckoutRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (
    !body.idempotency_key ||
    !Array.isArray(body.lines) ||
    body.lines.length === 0
  ) {
    return NextResponse.json(
      { error: 'idempotency_key + non-empty lines required' },
      { status: 400 }
    )
  }

  // Mixed per-line custom addresses are NOT supported in v1 (spec §9.1 /
  // plan ambiguity #3). If any line omits ship_to_store_id, ALL must, and a
  // custom_shipping_address must be present.
  const hasNullShipTo = body.lines.some((l) => !l.ship_to_store_id)
  const allNullShipTo = body.lines.every((l) => !l.ship_to_store_id)
  if (hasNullShipTo && !allNullShipTo) {
    return NextResponse.json(
      {
        error:
          'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.',
      },
      { status: 400 }
    )
  }
  if (allNullShipTo && !body.custom_shipping_address) {
    return NextResponse.json(
      { error: 'custom_shipping_address required when no ship_to_store_id provided' },
      { status: 400 }
    )
  }

  // Every ship_to_store_id must belong to the caller's org.
  const storeIds = body.lines
    .map((l) => l.ship_to_store_id)
    .filter((x): x is string => typeof x === 'string')
  for (const sid of storeIds) {
    if (!auth.context.storeIds.includes(sid)) {
      return NextResponse.json({ error: `Store ${sid} not on your account` }, { status: 400 })
    }
  }

  // Feature 1 — location_label, when present, must be a string or null. The PDP
  // dropdown hard-gate is the primary guarantee that it is a real dataset value;
  // this light shape guard just stops a forged/malformed POST writing junk to the
  // quote_items.line_location_label text column. Full dataset-membership
  // validation is a fast-follow (this route does not yet batch-load catalogue
  // items — it validates ship-to via the in-context store list, not the DB).
  for (const l of body.lines) {
    if (
      l.location_label !== undefined &&
      l.location_label !== null &&
      typeof l.location_label !== 'string'
    ) {
      return NextResponse.json(
        { error: 'location_label must be a string or null' },
        { status: 400 },
      )
    }
  }

  // Slice 4: only org admins on tenants that track stock may route to inventory.
  // Server enforces gating so a forged buyer/studio POST can't side-step the UI.
  let intent: 'customer' | 'inventory' = 'customer'
  if (body.intent === 'inventory') {
    const canRoute =
      auth.context.role === 'org_admin' &&
      (auth.context.tenantType === 'studio_plus_inventory' ||
        auth.context.tenantType === 'franchise')
    if (!canRoute) {
      return NextResponse.json(
        { error: 'Only org admins on inventory-tracking tenants can route orders to inventory' },
        { status: 403 },
      )
    }
    intent = 'inventory'
  }

  try {
    // F1 (spec B): split a mixed cart into TWO backend orders — the
    // made_to_order lines become a purchase_order (Monday/tracker path); the
    // stocked lines become order_type='stock_on_hand' (Spec A push-with-note +
    // notification). A homogeneous cart still makes a single call. Each partition
    // gets a distinct idempotency suffix so a retry after a partial failure
    // dedupes the already-committed order.
    const partitions = partitionCheckoutLines(body.lines)
    const orders: Array<{ order_id: string; order_ref: string; order_type: CheckoutOrderType }> = []
    for (const part of partitions) {
      const suffix = part.orderType === 'stock_on_hand' ? 'stock' : 'po'
      const result = await submitCustomerOrder(auth.admin, {
        context: auth.context,
        idempotency_key: `${body.idempotency_key}:${suffix}`,
        required_by: body.required_by ?? null,
        notes: body.notes ?? null,
        internal_notes: null,
        lines: part.lines,
        // Volume-tier pooling must span the WHOLE cart, not this partition:
        // the cart priced a product's tier off its total qty, so a split
        // partition re-pricing off its own qty alone would derive a higher
        // tier (drift 409 / silent overcharge). Pool lines seed pricing only.
        pricing_pool_lines: body.lines,
        custom_shipping_address: body.custom_shipping_address ?? null,
        intent,
        // order_type intentionally NOT passed: submit self-classifies each
        // homogeneous partition via classifyOrderType(input.lines) (the RPC has
        // no p_order_type param). The partition orderType — which equals that
        // derived value — drives only the idempotency suffix + the response.
      })
      orders.push({ ...result, order_type: part.orderType })
    }
    // New order(s) → both portal-data caches (account quotes, order-tracker) stale.
    revalidateTag(cacheTags.accountData, { expire: 0 })
    revalidateTag(cacheTags.orderTracker, { expire: 0 })
    // Primary (redirect target) is the purchase_order when present — it carries
    // the production tracker; otherwise the sole stock_on_hand order.
    const primary = orders[0]
    return NextResponse.json({ order_id: primary.order_id, order_ref: primary.order_ref, orders })
  } catch (e) {
    if (e instanceof DecorationDriftError) {
      return NextResponse.json(
        { error: 'decoration_price_drift', drift: e.drift },
        { status: 409 },
      )
    }
    if (e instanceof UnitPriceDriftError) {
      return NextResponse.json(
        { error: 'unit_price_drift', priceDrift: e.drift },
        { status: 409 },
      )
    }
    if (e instanceof BillingModeDriftError) {
      return NextResponse.json(
        { error: 'billing_mode_drift', billingDrift: e.drift },
        { status: 409 },
      )
    }
    if (e instanceof MemberAccessDriftError) {
      return NextResponse.json(
        { error: 'member_access_drift', drift: e.drift },
        { status: 409 },
      )
    }
    if (e instanceof MoqViolationError) {
      return NextResponse.json(
        { error: 'moq_violation', violations: e.violations },
        { status: 409 },
      )
    }
    if (e instanceof BuyerScopeError) {
      return NextResponse.json(
        {
          error: 'buyer_ship_to_mismatch',
          detail: {
            mismatched_store_ids: e.mismatchedStoreIds,
            default_store_id: e.defaultStoreId,
          },
        },
        { status: 409 },
      )
    }
    if (e instanceof MixedShippingAddressError) {
      return NextResponse.json(
        {
          error:
            'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.',
        },
        { status: 400 },
      )
    }
    if (e instanceof StockShortfallError) {
      return NextResponse.json(
        { error: e.detail.code, detail: e.detail },
        { status: 409 },
      )
    }
    const msg = (e as Error).message ?? ''
    if (msg.includes('OUT_OF_STOCK')) {
      return NextResponse.json({ error: 'OUT_OF_STOCK' }, { status: 409 })
    }
    // submit_b2b_order raises PERMISSION_DENIED when the member's ordering
    // permission forbids the line's fulfilment (e.g. a stock_only member on a
    // made_to_order product). It's an authorisation outcome, not a server
    // fault — surface it as 403 with a readable message rather than a bare 500.
    if (msg.includes('PERMISSION_DENIED')) {
      return NextResponse.json(
        {
          error: 'PERMISSION_DENIED',
          message:
            "Your account isn't permitted to place this type of order. Contact your organisation admin.",
        },
        { status: 403 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
