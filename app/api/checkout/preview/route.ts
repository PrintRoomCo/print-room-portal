import { NextResponse } from 'next/server'

import {
  getOrgEnabledCountries,
  type BillingCountryConfig,
} from '@/lib/account/org-countries'
import { sanitiseCustomName } from '@/lib/cart/custom-name'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import {
  buildCheckoutExecutionPlan,
  type CheckoutExecutionLine,
} from '@/lib/checkout/execution-plan'
import {
  BillingModeDriftError,
  BuyerScopeError,
  CountryPriceUnavailableError,
  DecorationDriftError,
  DisabledCountryError,
  MemberAccessDriftError,
  MixedShippingAddressError,
  MoqViolationError,
  UnitPriceDriftError,
} from '@/lib/checkout/errors'
import {
  prepareCustomerOrderPartition,
  type PreparedCheckoutPartition,
} from '@/lib/checkout/prepare'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import {
  validateDestinationRequest,
  type DestinationRequestAccepted,
} from '@/lib/checkout/destination-request'
import { pooledMinimumNotional } from '@/lib/checkout/minimum-order'
import { isoCountryOrNull } from '@/lib/checkout/shipping-address'
import type { CheckoutLineInput } from '@/lib/checkout/submit'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'

interface PreviewRequestBody {
  idempotency_key?: string
  required_by?: string | null
  notes?: string | null
  intent?: 'customer' | 'inventory'
  lines?: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
  /** Split shipment. Validated and re-derived server-side; never trusted as sent. */
  destinations?: unknown
  default_destination_ref?: unknown
}

export type PreviewPartitionOutcome =
  | { ok: true; partition: PreparedCheckoutPartition }
  | {
      ok: false
      partitionKey: string
      countryCode: string
      country: BillingCountryConfig
      code: string
      error: string
    }

function pricingFailure(
  error: unknown,
  partitionKey: string,
  country: BillingCountryConfig,
): PreviewPartitionOutcome {
  const failureContext = {
    partitionKey,
    countryCode: country.code,
    country,
  }
  if (error instanceof CountryPriceUnavailableError) {
    return {
      ok: false,
      ...failureContext,
      code: error.code,
      error: error.message,
    }
  }
  if (error instanceof UnitPriceDriftError) {
    return {
      ok: false,
      ...failureContext,
      code: 'unit_price_drift',
      error: error.message,
    }
  }
  if (error instanceof DecorationDriftError) {
    return {
      ok: false,
      ...failureContext,
      code: 'decoration_price_drift',
      error: error.message,
    }
  }
  if (error instanceof BillingModeDriftError) {
    return {
      ok: false,
      ...failureContext,
      code: 'billing_mode_drift',
      error: error.message,
    }
  }
  if (error instanceof MemberAccessDriftError) {
    return {
      ok: false,
      ...failureContext,
      code: 'member_access_drift',
      error: error.message,
    }
  }
  if (error instanceof MoqViolationError) {
    return {
      ok: false,
      ...failureContext,
      code: 'moq_violation',
      error: error.message,
    }
  }
  if (error instanceof BuyerScopeError) {
    return {
      ok: false,
      ...failureContext,
      code: 'buyer_ship_to_mismatch',
      error: error.message,
    }
  }
  if (error instanceof DisabledCountryError) {
    return {
      ok: false,
      ...failureContext,
      code: 'disabled_country',
      error: error.message,
    }
  }
  if (error instanceof MixedShippingAddressError) {
    return {
      ok: false,
      ...failureContext,
      code: 'mixed_shipping_address',
      error: error.message,
    }
  }
  return {
    ok: false,
    ...failureContext,
    code: 'preview_failed',
    error: 'This order group could not be priced. Please try again.',
  }
}

export async function POST(request: Request) {
  if (!isCheckoutCountryPartitionEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = await requireB2BCustomerApi({ requireCustomerCode: true })
  if ('error' in auth) return auth.error

  let body: PreviewRequestBody
  try {
    body = (await request.json()) as PreviewRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.idempotency_key || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json(
      { error: 'idempotency_key + non-empty lines required' },
      { status: 400 },
    )
  }

  // A split order carries its addresses on its destinations, not its lines, so
  // the single-address invariants below do not apply to it. They still guard
  // every other order.
  const splitRequested = body.destinations != null

  const hasNullShipTo = body.lines.some((line) => !line.ship_to_store_id)
  const allNullShipTo = body.lines.every((line) => !line.ship_to_store_id)
  if (!splitRequested && hasNullShipTo && !allNullShipTo) {
    return NextResponse.json(
      {
        error:
          'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.',
      },
      { status: 400 },
    )
  }
  if (!splitRequested && allNullShipTo && !body.custom_shipping_address) {
    return NextResponse.json(
      { error: 'custom_shipping_address required when no ship_to_store_id provided' },
      { status: 400 },
    )
  }

  // On the split path the stores to vet are the DESTINATIONS' stores; the lines
  // have not been exploded yet and carry none.
  const destinationStoreIds = splitRequested
    ? (Array.isArray(body.destinations) ? body.destinations : [])
        .map((destination) => (destination as { ship_to_store_id?: unknown })?.ship_to_store_id)
        .filter((value): value is string => typeof value === 'string')
    : []
  const storeIds = Array.from(
    new Set([
      ...body.lines
        .map((line) => line.ship_to_store_id)
        .filter((value): value is string => typeof value === 'string'),
      ...destinationStoreIds,
    ]),
  )
  for (const storeId of storeIds) {
    if (!auth.context.storeIds.includes(storeId)) {
      return NextResponse.json(
        { error: `Store ${storeId} not on your account` },
        { status: 400 },
      )
    }
  }

  for (const line of body.lines) {
    if (
      line.location_label !== undefined &&
      line.location_label !== null &&
      typeof line.location_label !== 'string'
    ) {
      return NextResponse.json(
        { error: 'location_label must be a string or null' },
        { status: 400 },
      )
    }
    if (
      line.custom_name !== undefined &&
      line.custom_name !== null &&
      typeof line.custom_name !== 'string'
    ) {
      return NextResponse.json(
        { error: 'custom_name must be a string or null' },
        { status: 400 },
      )
    }
    if (typeof line.custom_name === 'string') {
      line.custom_name = sanitiseCustomName(line.custom_name, null)
    }
  }

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
      return NextResponse.json(
        {
          error: 'buyer_ship_to_mismatch',
          detail: {
            mismatched_store_ids: branchScope.mismatched,
            default_store_id: auth.context.defaultStoreId,
          },
        },
        { status: 409 },
      )
    }
    if (!branchScope.ok && branchScope.kind === 'mixed_branch') {
      return NextResponse.json(
        {
          error:
            'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.',
        },
        { status: 400 },
      )
    }
  }

  const countries = await getOrgEnabledCountries(
    auth.admin,
    auth.context.organizationId,
  )
  const countryByCode = new Map(countries.map((country) => [country.code, country]))
  const countryByStoreId = new Map<string, string>()
  if (storeIds.length > 0) {
    const { data: storeRows, error } = await auth.admin
      .from('stores')
      .select('id, country')
      .eq('organization_id', auth.context.organizationId)
      .in('id', storeIds)
    if (error || (storeRows ?? []).length !== storeIds.length) {
      return NextResponse.json({ error: 'One or more stores are unavailable' }, { status: 400 })
    }
    for (const row of storeRows ?? []) {
      const countryCode =
        typeof row.country === 'string' && /^[A-Z]{2}$/.test(row.country)
          ? row.country
          : null
      if (!countryCode || !countryByCode.has(countryCode)) {
        return NextResponse.json(
          { error: 'The shipping address country is not enabled for your organisation.' },
          { status: 400 },
        )
      }
      countryByStoreId.set(row.id as string, countryCode)
    }
  }

  let customCountry: string | null = null
  if (body.custom_shipping_address) {
    customCountry = isoCountryOrNull(
      typeof body.custom_shipping_address.country === 'string'
        ? body.custom_shipping_address.country
        : null,
    )
    if (!customCountry || !countryByCode.has(customCountry)) {
      return NextResponse.json(
        { error: 'The shipping address country is not enabled for your organisation.' },
        { status: 400 },
      )
    }
    body.custom_shipping_address.country = customCountry
  }

  let splitContext: DestinationRequestAccepted | null = null
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
        storeIds.map((storeId) => [storeId, countryByStoreId.get(storeId) ?? null]),
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
  }

  // On the split path each EXPLODED line takes its destination's country, which
  // is what partitions a cross-country split into one order per country.
  const lines: CheckoutExecutionLine[] = splitContext
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

  const preparePartition = async (
    partition: (typeof executionPlan.partitions)[number],
    country: BillingCountryConfig,
    pooledMinimum?: number,
  ) =>
    prepareCustomerOrderPartition(
      auth.admin,
      {
        context: auth.context,
        idempotency_key: partition.idempotencyKey,
        required_by: body.required_by ?? null,
        notes: body.notes ?? null,
        internal_notes: null,
        lines: partition.lines,
        // The FULL exploded set: pooling (pricing, MOQ) must see the whole cart.
        // These are the same object references every partition got, which is why
        // explodeCheckoutLines must never mutate its input.
        pricing_pool_lines: lines,
        custom_shipping_address: body.custom_shipping_address ?? null,
        intent,
        // SERVER-OWNED. Built here from validated data, never read off the body.
        ...(splitContext
          ? {
              destinations: splitContext.destinations.filter((destination) =>
                partition.lines.some((line) => line.destination_ref === destination.ref),
              ),
            }
          : {}),
        ...(pooledMinimum === undefined ? {} : { pooled_minimum_notional: pooledMinimum }),
      },
      {
        countryPartitionEnabled: true,
        partitionKey: partition.key,
        country,
      },
    )

  const outcomes: PreviewPartitionOutcome[] = []
  for (const partition of executionPlan.partitions) {
    const country = countryByCode.get(partition.countryCode!)!
    try {
      outcomes.push({ ok: true, partition: await preparePartition(partition, country) })
    } catch (error) {
      outcomes.push(pricingFailure(error, partition.key, country))
    }
  }

  // The $500 minimum is a whole-order rule. A partition judged on its own slice
  // can fail it while the cart clears it comfortably, so any partition that came
  // back unmet is re-priced against the pooled notional. Only unmet partitions
  // are redone: a met verdict cannot change by adding value to the pool.
  const unmetIndexes = outcomes.flatMap((outcome, index) =>
    outcome.ok &&
    outcome.partition.orderType === 'purchase_order' &&
    outcome.partition.minimumOrder.applies &&
    !outcome.partition.minimumOrder.met
      ? [index]
      : [],
  )
  // Gated on the split path only. Task 8's step 1 requires a request WITHOUT
  // destinations to take the existing code path character-identically, so
  // pooling the minimum for ordinary cross-country carts stays a separate call.
  if (splitContext && unmetIndexes.length > 0 && executionPlan.partitions.length > 1) {
    // Imported lazily: this module wraps unstable_cache, and pulling
    // next/cache into the route at load time breaks route tests that mock
    // next/cache without it. Only a cross-currency split ever needs rates.
    const { getServerExchangeRates } = await import(
      '@/lib/currency/server-exchange-rates'
    )
    const { rates } = await getServerExchangeRates()
    const poolPartitions = outcomes.flatMap((outcome) =>
      outcome.ok
        ? [
            {
              currency: outcome.partition.country.currency,
              orderType: outcome.partition.orderType,
              notionalValue: outcome.partition.minimumOrder.value,
            },
          ]
        : [],
    )
    for (const index of unmetIndexes) {
      const partition = executionPlan.partitions[index]
      const country = countryByCode.get(partition.countryCode!)!
      try {
        outcomes[index] = {
          ok: true,
          partition: await preparePartition(
            partition,
            country,
            pooledMinimumNotional({
              partitions: poolPartitions,
              targetCurrency: country.currency,
              ratesFromNzd: rates as unknown as Record<string, number>,
            }),
          ),
        }
      } catch (error) {
        outcomes[index] = pricingFailure(error, partition.key, country)
      }
    }
  }

  const totalsByCurrency: Record<string, number> = {}
  for (const outcome of outcomes) {
    if (!outcome.ok) continue
    const currency = outcome.partition.country.currency
    totalsByCurrency[currency] = Number(
      ((totalsByCurrency[currency] ?? 0) + outcome.partition.totals.total).toFixed(2),
    )
  }

  return NextResponse.json({ outcomes, totalsByCurrency })
}
