import { NextResponse } from 'next/server'

import { getOrgEnabledCountries } from '@/lib/account/org-countries'
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
import { isoCountryOrNull } from '@/lib/checkout/shipping-address'
import type { CheckoutLineInput } from '@/lib/checkout/submit'

interface PreviewRequestBody {
  idempotency_key?: string
  required_by?: string | null
  notes?: string | null
  intent?: 'customer' | 'inventory'
  lines?: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
}

export type PreviewPartitionOutcome =
  | { ok: true; partition: PreparedCheckoutPartition }
  | {
      ok: false
      partitionKey: string
      countryCode: string
      code: string
      error: string
    }

function pricingFailure(
  error: unknown,
  partitionKey: string,
  countryCode: string,
): PreviewPartitionOutcome {
  if (error instanceof CountryPriceUnavailableError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: error.code,
      error: error.message,
    }
  }
  if (error instanceof UnitPriceDriftError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'unit_price_drift',
      error: error.message,
    }
  }
  if (error instanceof DecorationDriftError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'decoration_price_drift',
      error: error.message,
    }
  }
  if (error instanceof BillingModeDriftError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'billing_mode_drift',
      error: error.message,
    }
  }
  if (error instanceof MemberAccessDriftError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'member_access_drift',
      error: error.message,
    }
  }
  if (error instanceof MoqViolationError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'moq_violation',
      error: error.message,
    }
  }
  if (error instanceof BuyerScopeError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'buyer_ship_to_mismatch',
      error: error.message,
    }
  }
  if (error instanceof DisabledCountryError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'disabled_country',
      error: error.message,
    }
  }
  if (error instanceof MixedShippingAddressError) {
    return {
      ok: false,
      partitionKey,
      countryCode,
      code: 'mixed_shipping_address',
      error: error.message,
    }
  }
  return {
    ok: false,
    partitionKey,
    countryCode,
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

  const hasNullShipTo = body.lines.some((line) => !line.ship_to_store_id)
  const allNullShipTo = body.lines.every((line) => !line.ship_to_store_id)
  if (hasNullShipTo && !allNullShipTo) {
    return NextResponse.json(
      {
        error:
          'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.',
      },
      { status: 400 },
    )
  }
  if (allNullShipTo && !body.custom_shipping_address) {
    return NextResponse.json(
      { error: 'custom_shipping_address required when no ship_to_store_id provided' },
      { status: 400 },
    )
  }

  const storeIds = Array.from(
    new Set(
      body.lines
        .map((line) => line.ship_to_store_id)
        .filter((value): value is string => typeof value === 'string'),
    ),
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
      const countryCode = isoCountryOrNull(row.country as string | null)
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

  const lines: CheckoutExecutionLine[] = body.lines.map((line) => ({
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

  const outcomes: PreviewPartitionOutcome[] = []
  const totalsByCurrency: Record<string, number> = {}
  for (const partition of executionPlan.partitions) {
    const countryCode = partition.countryCode!
    const country = countryByCode.get(countryCode)!
    try {
      const prepared = await prepareCustomerOrderPartition(
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
        },
        {
          countryPartitionEnabled: true,
          partitionKey: partition.key,
          country,
        },
      )
      outcomes.push({ ok: true, partition: prepared })
      totalsByCurrency[country.currency] = Number(
        ((totalsByCurrency[country.currency] ?? 0) + prepared.totals.total).toFixed(2),
      )
    } catch (error) {
      outcomes.push(pricingFailure(error, partition.key, countryCode))
    }
  }

  return NextResponse.json({ outcomes, totalsByCurrency })
}
