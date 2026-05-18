import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import {
  BuyerScopeError,
  DecorationDriftError,
  MemberAccessDriftError,
  MoqViolationError,
  StockShortfallError,
  UnitPriceDriftError,
  submitCustomerOrder,
  type CheckoutLineInput,
} from '@/lib/checkout/submit'

interface CheckoutRequestBody {
  idempotency_key?: string
  required_by?: string | null
  notes?: string | null
  lines?: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
  /**
   * Cart-level fast-path: every line routes to inventory regardless of its
   * per-line `route_to_inventory`. Gated to org_admin on inventory-tracking
   * tenants — same gate as the per-line flag, enforced below.
   */
  route_entire_order_to_inventory?: boolean
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

  // Inventory routing gate. Required when ANY line carries
  // `route_to_inventory === true` OR the cart-level fast-path is set. Same
  // role+tenant policy whether the routing was per-line (PDP toggle) or
  // order-level (admin fast-path) — a forged buyer POST mustn't side-step the
  // UI gate just because it picked a different field.
  const wantsInventoryRouting =
    body.route_entire_order_to_inventory === true ||
    body.lines.some((l) => l.route_to_inventory === true)
  if (wantsInventoryRouting) {
    const canRoute =
      auth.context.role === 'org_admin' &&
      (auth.context.tenantType === 'studio_plus_inventory' ||
        auth.context.tenantType === 'franchise')
    if (!canRoute) {
      return NextResponse.json(
        {
          error: 'ROUTE_TO_INVENTORY_NOT_ALLOWED',
          detail: 'Your role or tenant does not permit inventory routing.',
        },
        { status: 403 },
      )
    }
  }

  try {
    const result = await submitCustomerOrder(auth.admin, {
      context: auth.context,
      idempotency_key: body.idempotency_key,
      required_by: body.required_by ?? null,
      notes: body.notes ?? null,
      internal_notes: null,
      lines: body.lines,
      custom_shipping_address: body.custom_shipping_address ?? null,
      route_entire_order_to_inventory: body.route_entire_order_to_inventory === true,
    })

    // Discriminated union response. `kind` is included for both variants so the
    // client can branch without sniffing for fields. The single-variant shape
    // remains backwards compatible with existing readers that just pluck
    // `order_id` + `order_ref` off the top level.
    if (result.kind === 'split') {
      return NextResponse.json({
        kind: 'split',
        customer_order_id: result.customer_order_id,
        customer_order_ref: result.customer_order_ref,
        customer_quote_id: result.customer_quote_id,
        inventory_order_id: result.inventory_order_id,
        inventory_order_ref: result.inventory_order_ref,
        inventory_quote_id: result.inventory_quote_id,
        cart_submission_id: result.cart_submission_id,
      })
    }
    return NextResponse.json({
      kind: 'single',
      order_id: result.order_id,
      order_ref: result.order_ref,
      quote_id: result.quote_id,
    })
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
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
