import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import {
  BillingModeDriftError,
  BuyerScopeError,
  DecorationDriftError,
  MemberAccessDriftError,
  MinimumOrderValueError,
  MixedShippingAddressError,
  DisabledCountryError,
  MoqViolationError,
  StockShortfallError,
  UnitPriceDriftError,
  submitCustomerOrder,
  type CheckoutLineInput,
} from '@/lib/checkout/submit'
import { cacheTags } from '@/lib/cache/tags'
import { partitionCheckoutLines, type CheckoutOrderType } from '@/lib/checkout/partition'
import { sanitiseCustomName } from '@/lib/cart/custom-name'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import { getOrgEnabledCountries } from '@/lib/account/org-countries'
import { buildCheckoutExecutionPlan } from '@/lib/checkout/execution-plan'
import { isoCountryOrNull } from '@/lib/checkout/shipping-address'
import { CountryPriceUnavailableError } from '@/lib/checkout/errors'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'
import {
  validateDestinationRequest,
  type DestinationRequestAccepted,
} from '@/lib/checkout/destination-request'
import { pooledMinimumNotional } from '@/lib/checkout/minimum-order'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'

interface CheckoutRequestBody {
  idempotency_key?: string
  required_by?: string | null
  notes?: string | null
  /** Slice 4: 'inventory' routes the order into the org's stock shelf instead of a customer delivery. */
  intent?: 'customer' | 'inventory'
  lines?: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
  /**
   * Design 2026-08-11: the buyer's affirmative T&C acceptance + the exact
   * version string they saw. The route rejects (400) unless terms_accepted ===
   * true AND terms_version is a non-empty string; both are threaded to
   * submitCustomerOrder. No honeypot field — the honeypot is client-only.
   */
  terms_accepted?: boolean
  terms_version?: string
  /** Split shipment. Validated and re-derived server-side; never trusted as sent. */
  destinations?: unknown
  default_destination_ref?: unknown
}

export type CheckoutPartitionOutcome =
  | {
      ok: true
      partitionKey: string
      countryCode: string
      currency: string
      orderType: CheckoutOrderType
      orderId: string
      orderRef: string
    }
  | {
      ok: false
      partitionKey: string
      countryCode: string
      currency: string
      orderType: CheckoutOrderType
      code: string
      error: string
      detail?: unknown
    }

function partitionFailureOutcome(input: {
  error: unknown
  partitionKey: string
  countryCode: string
  currency: string
  orderType: CheckoutOrderType
}): CheckoutPartitionOutcome {
  const base = {
    ok: false as const,
    partitionKey: input.partitionKey,
    countryCode: input.countryCode,
    currency: input.currency,
    orderType: input.orderType,
  }
  const error = input.error
  if (error instanceof CountryPriceUnavailableError) {
    return { ...base, code: error.code, error: error.message, detail: error.detail }
  }
  if (error instanceof DecorationDriftError) {
    return {
      ...base,
      code: 'decoration_price_drift',
      error: error.message,
      detail: error.drift,
    }
  }
  if (error instanceof UnitPriceDriftError) {
    return { ...base, code: 'unit_price_drift', error: error.message, detail: error.drift }
  }
  if (error instanceof BillingModeDriftError) {
    return {
      ...base,
      code: 'billing_mode_drift',
      error: error.message,
      detail: error.drift,
    }
  }
  if (error instanceof MemberAccessDriftError) {
    return { ...base, code: 'member_access_drift', error: error.message, detail: error.drift }
  }
  if (error instanceof MinimumOrderValueError) {
    // `error` renders verbatim in the partition failure UI, and
    // MinimumOrderValueError.message is already the finished sentence.
    return { ...base, code: error.code, error: error.message, detail: error.status }
  }
  if (error instanceof MoqViolationError) {
    return { ...base, code: 'moq_violation', error: error.message, detail: error.violations }
  }
  if (error instanceof BuyerScopeError) {
    return {
      ...base,
      code: 'buyer_ship_to_mismatch',
      error: error.message,
      detail: {
        mismatched_store_ids: error.mismatchedStoreIds,
        default_store_id: error.defaultStoreId,
      },
    }
  }
  if (error instanceof DisabledCountryError) {
    return { ...base, code: 'disabled_country', error: error.message }
  }
  if (error instanceof MixedShippingAddressError) {
    return { ...base, code: 'mixed_shipping_address', error: error.message }
  }
  if (error instanceof StockShortfallError) {
    return { ...base, code: error.detail.code, error: error.message, detail: error.detail }
  }
  const message = error instanceof Error ? error.message : ''
  if (message.includes('OUT_OF_STOCK')) {
    return { ...base, code: 'OUT_OF_STOCK', error: 'OUT_OF_STOCK' }
  }
  if (message.includes('PERMISSION_DENIED')) {
    return {
      ...base,
      code: 'PERMISSION_DENIED',
      error: "Your account isn't permitted to place this type of order. Contact your organisation admin.",
    }
  }
  console.error('[Checkout] country partition failed', {
    partitionKey: input.partitionKey,
    countryCode: input.countryCode,
    orderType: input.orderType,
  })
  return {
    ...base,
    code: 'order_submit_failed',
    error: 'This order group could not be submitted. Please try again.',
  }
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

  // Terms & Conditions gate (design 2026-08-11, Decision 2 — THE legal proof).
  // No order is ever created unless the buyer affirmatively accepted a specific,
  // non-empty terms version. This structural guarantee — not the best-effort
  // audit write — is what makes "an order exists" imply "terms were accepted".
  if (
    body.terms_accepted !== true ||
    typeof body.terms_version !== 'string' ||
    body.terms_version.trim() === ''
  ) {
    return NextResponse.json({ error: 'terms_not_accepted' }, { status: 400 })
  }

  // Mixed per-line custom addresses are NOT supported in v1 (spec §9.1 /
  // plan ambiguity #3). If any line omits ship_to_store_id, ALL must, and a
  // custom_shipping_address must be present.
  // A split order carries its addresses on its destinations, not its lines.
  const splitRequested = body.destinations != null

  const hasNullShipTo = body.lines.some((l) => !l.ship_to_store_id)
  const allNullShipTo = body.lines.every((l) => !l.ship_to_store_id)
  if (!splitRequested && hasNullShipTo && !allNullShipTo) {
    return NextResponse.json(
      {
        error:
          'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.',
      },
      { status: 400 }
    )
  }
  if (!splitRequested && allNullShipTo && !body.custom_shipping_address) {
    return NextResponse.json(
      { error: 'custom_shipping_address required when no ship_to_store_id provided' },
      { status: 400 }
    )
  }

  // Every ship_to_store_id must belong to the caller's org. On the split path
  // the stores to vet live on the destinations, since the lines are not yet
  // exploded and carry none.
  const destinationStoreIds = splitRequested
    ? (Array.isArray(body.destinations) ? body.destinations : [])
        .map((destination) => (destination as { ship_to_store_id?: unknown })?.ship_to_store_id)
        .filter((value): value is string => typeof value === 'string')
    : []
  const storeIds = [
    ...body.lines
      .map((l) => l.ship_to_store_id)
      .filter((x): x is string => typeof x === 'string'),
    ...destinationStoreIds,
  ]
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

    // Feature 2 — custom_name shape guard + server-side sanitise (defence). The
    // PDP maxLength + client sanitiser is the primary cap; the route cannot know
    // the per-product cap (it does not batch-load catalogue items), so it clamps
    // to the 30-char ceiling only. Mutate in place so both part.lines and
    // pricing_pool_lines carry the sanitised value.
    if (
      l.custom_name !== undefined &&
      l.custom_name !== null &&
      typeof l.custom_name !== 'string'
    ) {
      return NextResponse.json(
        { error: 'custom_name must be a string or null' },
        { status: 400 },
      )
    }
    if (typeof l.custom_name === 'string') {
      l.custom_name = sanitiseCustomName(l.custom_name, null)
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
    if (isCheckoutCountryPartitionEnabled()) {
      if (!splitRequested && auth.context.role === 'staff') {
        const branchScope = checkStaffBranchScope({
          shipToStoreIds: body.lines.map((line) => line.ship_to_store_id ?? null),
          allowedBranches: resolveBranchStoreIds(
            auth.context.branchStoreIds,
            auth.context.defaultStoreId,
          ),
          allOneTimeLines: allNullShipTo,
          hasCustomShippingAddress: Boolean(body.custom_shipping_address),
        })
        if (!branchScope.ok && branchScope.kind === 'out_of_scope') {
          throw new BuyerScopeError(
            branchScope.mismatched,
            auth.context.defaultStoreId,
          )
        }
        if (!branchScope.ok && branchScope.kind === 'mixed_branch') {
          throw new MixedShippingAddressError()
        }
      }

      const countries = await getOrgEnabledCountries(
        auth.admin,
        auth.context.organizationId,
      )
      const countryByCode = new Map(countries.map((country) => [country.code, country]))
      const uniqueStoreIds = Array.from(new Set(storeIds))
      const countryByStoreId = new Map<string, string>()

      if (uniqueStoreIds.length > 0) {
        const { data: storeRows, error: storeError } = await auth.admin
          .from('stores')
          .select('id, country')
          .eq('organization_id', auth.context.organizationId)
          .in('id', uniqueStoreIds)
        if (storeError || (storeRows ?? []).length !== uniqueStoreIds.length) {
          throw new DisabledCountryError('')
        }
        for (const row of storeRows ?? []) {
          const countryCode =
            typeof row.country === 'string' && /^[A-Z]{2}$/.test(row.country)
              ? row.country
              : null
          if (!countryCode || !countryByCode.has(countryCode)) {
            throw new DisabledCountryError(countryCode ?? '')
          }
          countryByStoreId.set(row.id as string, countryCode)
        }
      }

      let customCountry: string | null = null
      // `allNullShipTo` is read off the UN-EXPLODED lines, so it is always true
      // for a split order: its lines carry no store, its destinations do. Only
      // the single-address path has an order-level country to resolve, and only
      // that path reads `customCountry` (see the non-split branch below).
      if (!splitRequested && allNullShipTo) {
        const rawCountry = body.custom_shipping_address?.country
        customCountry = isoCountryOrNull(
          typeof rawCountry === 'string' ? rawCountry : null,
        )
        if (!customCountry || !countryByCode.has(customCountry)) {
          throw new DisabledCountryError(customCountry ?? '')
        }
        body.custom_shipping_address!.country = customCountry
      }

      let splitContext: DestinationRequestAccepted | null = null
      // address_snapshot is resolved HERE, at submit, by the actor that just
      // validated the address: a later edit to the store must never rewrite the
      // history of an order already placed.
      const addressSnapshotByRef = new Map<string, Record<string, unknown>>()
      if (splitRequested) {
        const { data: orgRow } = await auth.admin
          .from('organizations')
          .select('split_shipping_enabled')
          .eq('id', auth.context.organizationId)
          .maybeSingle()

        const validated = validateDestinationRequest({
          destinations: body.destinations,
          defaultDestinationRef: body.default_destination_ref,
          lines: body.lines,
          splitShippingEnabled: orgRow?.split_shipping_enabled === true,
          orgStoreCountryById: new Map(
            uniqueStoreIds.map((storeId) => [storeId, countryByStoreId.get(storeId) ?? null]),
          ),
          staffScope:
            auth.context.role === 'staff'
              ? {
                  allowedBranchIds: resolveBranchStoreIds(
                    auth.context.branchStoreIds,
                    auth.context.defaultStoreId,
                  ),
                  defaultStoreId: auth.context.defaultStoreId ?? null,
                }
              : null,
        })
        if (!validated.ok) {
          return NextResponse.json(validated.body, { status: validated.status })
        }
        splitContext = validated

        // Store destinations snapshot the store row in the same shape prepare
        // builds a header shippingAddress from; ad-hoc ones snapshot the address
        // the customer entered, verbatim.
        const snapshotStoreIds = splitContext.destinations
          .map((destination) => destination.ship_to_store_id)
          .filter((value): value is string => typeof value === 'string')
        const storeRowById = new Map<string, Record<string, unknown>>()
        if (snapshotStoreIds.length > 0) {
          const { data: snapshotRows, error: snapshotError } = await auth.admin
            .from('stores')
            .select('id, name, address, city, state, country, postal_code')
            .eq('organization_id', auth.context.organizationId)
            .in('id', snapshotStoreIds)
          if (snapshotError || (snapshotRows ?? []).length !== snapshotStoreIds.length) {
            return NextResponse.json(
              { error: 'One or more destination stores are unavailable', code: 'unknown_destination' },
              { status: 400 },
            )
          }
          for (const row of snapshotRows ?? []) {
            storeRowById.set(row.id as string, row as Record<string, unknown>)
          }
        }
        for (const destination of splitContext.destinations) {
          addressSnapshotByRef.set(
            destination.ref,
            destination.ship_to_store_id
              ? storeRowById.get(destination.ship_to_store_id) ?? {}
              : ((destination.custom_address ?? {}) as unknown as Record<string, unknown>),
          )
        }
      }

      const lines = splitContext
        ? splitContext.lines.map((line) => ({
            ...line,
            ship_country: splitContext!.countryByRef.get(line.destination_ref ?? ''),
          }))
        : body.lines.map((line) => ({
            ...line,
            ship_country: line.ship_to_store_id
              ? countryByStoreId.get(line.ship_to_store_id)
              : customCountry ?? undefined,
          }))
      const executionPlan = buildCheckoutExecutionPlan(
        {
          idempotencyKey: body.idempotency_key,
          lines,
          countryOrder: countries.map((country) => country.code),
        },
        true,
      )
      // The $500 minimum is a whole-order rule. Submit cannot price, check and
      // retry the way preview does (it writes), so for a split order spanning
      // more than one partition the pooled notional is derived up front from a
      // read-only prepare pass and handed to every submit call.
      let pooledMinimumNotionals: Array<{
        currency: string
        orderType: 'purchase_order' | 'stock_on_hand'
        notionalValue: number
      }> | null = null
      let pooledMinimumRates: Record<string, number> | null = null
      if (splitContext && executionPlan.partitions.length > 1) {
        // Lazy, like the rates module below: prepare.ts pulls next/cache in
        // transitively, and this route's tests mock submit but not prepare.
        const { prepareCustomerOrderPartition } = await import('@/lib/checkout/prepare')
        const notionals: Array<{
          currency: string
          orderType: 'purchase_order' | 'stock_on_hand'
          notionalValue: number
        }> = []
        for (const partition of executionPlan.partitions) {
          const country = countryByCode.get(partition.countryCode!)!
          const probe = await prepareCustomerOrderPartition(
            auth.admin,
            {
              context: auth.context,
              idempotency_key: partition.idempotencyKey,
              required_by: body.required_by ?? null,
              notes: body.notes ?? null,
              internal_notes: null,
              lines: partition.lines,
              pricing_pool_lines: lines,
              custom_shipping_address: body.custom_shipping_address ?? null,
              intent,
              destinations: splitContext.destinations.filter((destination) =>
                partition.lines.some((line) => line.destination_ref === destination.ref),
              ),
            },
            { countryPartitionEnabled: true, partitionKey: partition.key, country },
          )
          notionals.push({
            currency: probe.country.currency,
            orderType: probe.orderType,
            notionalValue: probe.minimumOrder.value,
          })
        }
        // Imported lazily: this module wraps unstable_cache, and pulling
        // next/cache into the route at load time breaks route tests that mock
        // next/cache without it. Only a cross-currency split ever needs rates.
        const { getServerExchangeRates } = await import(
          '@/lib/currency/server-exchange-rates'
        )
        const { rates } = await getServerExchangeRates()
        pooledMinimumRates = rates as unknown as Record<string, number>
        pooledMinimumNotionals = notionals
      }

      const outcomes: CheckoutPartitionOutcome[] = []
      for (const partition of executionPlan.partitions) {
        const countryCode = partition.countryCode!
        const country = countryByCode.get(countryCode)!
        try {
          const result = await submitCustomerOrder(
            auth.admin,
            {
              context: auth.context,
              idempotency_key: partition.idempotencyKey,
              required_by: body.required_by ?? null,
              notes: body.notes ?? null,
              internal_notes: null,
              lines: partition.lines,
              pricing_pool_lines: lines,
              custom_shipping_address: body.custom_shipping_address ?? null,
              intent,
              terms_accepted: body.terms_accepted,
              terms_version: body.terms_version,
              // SERVER-OWNED. Built from validated data above, never off the body.
              ...(splitContext
                ? {
                    destinations: splitContext.destinations
                      .filter((destination) =>
                        partition.lines.some((line) => line.destination_ref === destination.ref),
                      )
                      .map((destination) => ({
                        ...destination,
                        address_snapshot: addressSnapshotByRef.get(destination.ref) ?? {},
                      })),
                  }
                : {}),
              ...(pooledMinimumNotionals
                ? {
                    pooled_minimum_notional: pooledMinimumNotional({
                      partitions: pooledMinimumNotionals,
                      targetCurrency: country.currency,
                      ratesFromNzd: pooledMinimumRates ?? {},
                    }),
                  }
                : {}),
            },
            {
              countryPartitionEnabled: true,
              partitionKey: partition.key,
              country,
            },
          )
          outcomes.push({
            ok: true,
            partitionKey: partition.key,
            countryCode,
            currency: country.currency,
            orderType: partition.orderType,
            orderId: result.order_id,
            orderRef: result.order_ref,
          })
        } catch (error) {
          outcomes.push(
            partitionFailureOutcome({
              error,
              partitionKey: partition.key,
              countryCode,
              currency: country.currency,
              orderType: partition.orderType,
            }),
          )
        }
      }
      revalidateTag(cacheTags.accountData, { expire: 0 })
      revalidateTag(cacheTags.orderTracker, { expire: 0 })
      return NextResponse.json(
        { outcomes },
        { status: outcomes.every((outcome) => outcome.ok) ? 200 : 207 },
      )
    }

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
        // Consent for THIS order (design 2026-08-11). Both partitions of a split
        // cart carry the same acceptance — the customer agreed once for the cart.
        terms_accepted: body.terms_accepted,
        terms_version: body.terms_version,
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
    if (e instanceof MinimumOrderValueError) {
      // 422, not 409: nothing raced or drifted — the order is simply too small.
      return NextResponse.json(
        { code: e.code, status: e.status, message: e.message },
        { status: 422 },
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
    if (e instanceof DisabledCountryError) {
      return NextResponse.json(
        { error: 'The shipping address country is not enabled for your organisation.' },
        { status: 400 },
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
