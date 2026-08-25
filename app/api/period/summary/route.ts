import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { calculatePeriodSavingsOpportunity } from '@/lib/pricing/period-savings'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import { getOrgDefaultBillingCountry } from '@/lib/account/org-countries'

function requestedCartQuantities(request: Request): Map<string, number> {
  const quantities = new Map<string, number>()
  const values = new URL(request.url).searchParams.getAll('item').slice(0, 100)
  for (const value of values) {
    const separator = value.lastIndexOf(':')
    if (separator <= 0) continue
    const catalogueItemId = value.slice(0, separator)
    const qty = Math.floor(Number(value.slice(separator + 1)))
    if (!catalogueItemId || !Number.isFinite(qty) || qty <= 0) continue
    quantities.set(catalogueItemId, (quantities.get(catalogueItemId) ?? 0) + qty)
  }
  return quantities
}

export async function GET(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  const orgId = context.organizationId
  const role = context.role
  const cartQuantities = requestedCartQuantities(request)
  const countryPartitionEnabled = isCheckoutCountryPartitionEnabled()
  const defaultCountry = countryPartitionEnabled
    ? await getOrgDefaultBillingCountry(admin, orgId)
    : null

  const { data, error } = await admin.rpc('period_progress_for_org', {
    p_org_id: orgId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    period_id: string
    closes_at: string
    catalogue_item_id: string
    agg_qty: number
    order_count: number
    current_unit_price: number | null
    next_min_quantity: number | null
    next_unit_price: number | null
  }
  const rows = (data ?? []) as Row[]
  const isOrgAdmin = role === 'org_admin'
  const requestedIds =
    cartQuantities.size > 0
      ? new Set(cartQuantities.keys())
      : new Set(rows.map((row) => row.catalogue_item_id))
  const relevantRows = rows.filter((row) => requestedIds.has(row.catalogue_item_id))

  type BandRow = {
    catalogue_item_id: string
    min_quantity: number
    final_unit_price: number
  }
  let bandRows: BandRow[] = []
  if (rows[0] && requestedIds.size > 0) {
    let bandQuery = admin
      .from('b2b_ordering_period_item_pricing')
      .select('catalogue_item_id, min_quantity, final_unit_price')
      .eq('period_id', rows[0].period_id)
      .in('catalogue_item_id', [...requestedIds])
    if (defaultCountry) bandQuery = bandQuery.eq('currency', defaultCountry.currency)
    const bandResult = await bandQuery.order('min_quantity', { ascending: true })
    if (bandResult.error) {
      return NextResponse.json({ error: bandResult.error.message }, { status: 500 })
    }
    bandRows = (bandResult.data ?? []) as BandRow[]
  }

  const bandsByItem = new Map<
    string,
    Array<{ minQuantity: number; unitPrice: number }>
  >()
  for (const band of bandRows) {
    const itemBands = bandsByItem.get(band.catalogue_item_id) ?? []
    itemBands.push({
      minQuantity: band.min_quantity,
      unitPrice: Number(band.final_unit_price),
    })
    bandsByItem.set(band.catalogue_item_id, itemBands)
  }

  return NextResponse.json({
    period: rows[0]
      ? { id: rows[0].period_id, closesAt: rows[0].closes_at }
      : null,
    ...(defaultCountry ? { currency: defaultCountry.currency } : {}),
    items: relevantRows.map((row) => {
      const franchiseQty = cartQuantities.get(row.catalogue_item_id) ?? 0
      const opportunity = calculatePeriodSavingsOpportunity({
        networkQty: row.agg_qty,
        franchiseQty,
        bands: bandsByItem.get(row.catalogue_item_id) ?? [],
      })
      return {
        catalogueItemId: row.catalogue_item_id,
        // Raw network aggregates remain org_admin-only. Other members receive
        // only the derived price-break story, as before.
        aggQty: isOrgAdmin ? row.agg_qty : null,
        orderCount: isOrgAdmin ? row.order_count : null,
        unitsToNextBreak: opportunity?.unitsToNextSaving ?? null,
        currentUnitPrice: opportunity?.currentUnitPrice ?? null,
        nextUnitPrice: opportunity?.nextUnitPrice ?? null,
        perUnitSavings: opportunity?.perUnitSavings ?? null,
        franchiseSavings: opportunity?.franchiseSavings ?? null,
      }
    }),
  })
}
