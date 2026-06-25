import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
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
import { cacheTags } from '@/lib/cache/tags'

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
    const result = await submitCustomerOrder(auth.admin, {
      context: auth.context,
      idempotency_key: body.idempotency_key,
      required_by: body.required_by ?? null,
      notes: body.notes ?? null,
      internal_notes: null,
      lines: body.lines,
      custom_shipping_address: body.custom_shipping_address ?? null,
      intent,
    })
    // New order → both portal-data caches (account quotes, order-tracker) stale.
    revalidateTag(cacheTags.accountData, { expire: 0 })
    revalidateTag(cacheTags.orderTracker, { expire: 0 })
    return NextResponse.json(result)
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
