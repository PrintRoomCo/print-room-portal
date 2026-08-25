import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { effectiveUnitPrice, effectiveUnitPriceForItem } from '@/lib/shop/effective-price'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import { getOrgDefaultBillingCountry } from '@/lib/account/org-countries'
import {
  getOpenPeriodForOrg,
  getPeriodBracketsForItem,
  getPreOrderItemIds,
} from '@/lib/pricing/period-brackets'

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  let body: { product_id?: string; catalogue_item_id?: string; qty?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (
    !body.product_id ||
    !body.qty ||
    !Number.isInteger(body.qty) ||
    body.qty <= 0
  ) {
    return NextResponse.json(
      { error: 'product_id and positive integer qty required' },
      { status: 400 }
    )
  }

  const countryPartitionEnabled = isCheckoutCountryPartitionEnabled()
  if (countryPartitionEnabled) {
    if (!body.catalogue_item_id) {
      return NextResponse.json({ error: 'catalogue_item_id required' }, { status: 400 })
    }
    const { data: catalogueItem } = await admin
      .from('b2b_catalogue_items')
      .select('id, b2b_catalogues!inner(organization_id, is_active)')
      .eq('id', body.catalogue_item_id)
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', context.organizationId)
      .eq('b2b_catalogues.is_active', true)
      .maybeSingle()
    if (!catalogueItem) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const defaultCountry = await getOrgDefaultBillingCountry(admin, context.organizationId)
    const openPeriod = await getOpenPeriodForOrg(admin, context.organizationId)
    const preOrderItemIds = openPeriod
      ? await getPreOrderItemIds(admin, [body.catalogue_item_id])
      : new Set<string>()
    if (openPeriod && preOrderItemIds.has(body.catalogue_item_id)) {
      const periodBrackets = await getPeriodBracketsForItem(
        admin,
        openPeriod.id,
        body.catalogue_item_id,
        defaultCountry.currency,
        true,
      )
      const bracket = periodBrackets.find(
        (candidate) =>
          candidate.minQty <= body.qty! &&
          (candidate.maxQty == null || body.qty! <= candidate.maxQty),
      )
      const unitPrice = bracket?.unitPrice ?? null
      return NextResponse.json({
        unit_price: unitPrice ?? 0,
        total: unitPrice == null ? 0 : Number((unitPrice * body.qty).toFixed(2)),
        status: unitPrice == null ? 'missing' : 'ok',
        bracket: bracket
          ? { min_quantity: bracket.minQty, max_quantity: bracket.maxQty }
          : null,
        currency: defaultCountry.currency,
      })
    }
    const [unitPrice, { data: bracket }] = await Promise.all([
      effectiveUnitPriceForItem(
        admin,
        body.catalogue_item_id,
        context.organizationId,
        body.qty,
        defaultCountry.currency,
        true,
      ),
      admin
        .from('b2b_catalogue_item_pricing_tiers')
        .select('min_quantity, max_quantity')
        .eq('catalogue_item_id', body.catalogue_item_id)
        .eq('currency', defaultCountry.currency)
        .lte('min_quantity', body.qty)
        .order('min_quantity', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    return NextResponse.json({
      unit_price: unitPrice ?? 0,
      total: unitPrice == null ? 0 : Number((unitPrice * body.qty).toFixed(2)),
      status: unitPrice == null ? 'missing' : 'ok',
      bracket: bracket ?? null,
      currency: defaultCountry.currency,
    })
  }

  // Canonical pricing per project_b2b_pricing_canonical.md — never call
  // get_unit_price directly: it bypasses catalogue scope and returns 0.00 for
  // catalogue products without master pricing tiers.
  const [result, { data: bracket }] = await Promise.all([
    effectiveUnitPrice(admin, body.product_id, context.organizationId, body.qty),
    admin
      .from('product_pricing_tiers')
      .select('min_quantity, max_quantity')
      .eq('product_id', body.product_id)
      .eq('is_active', true)
      .lte('min_quantity', body.qty)
      .order('min_quantity', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    unit_price: result.unitPrice,
    total: Number((result.unitPrice * body.qty).toFixed(2)),
    status: result.status,
    bracket: bracket ?? null,
  })
}
