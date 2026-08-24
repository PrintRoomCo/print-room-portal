import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import { getOrgDefaultBillingCountry } from '@/lib/account/org-countries'

interface Item {
  linkId: string
  /** Screenprint context from the PDP. Informational — priceLink re-resolves
   *  everything server-side from the linkId. Absent for embroidery items. */
  placementKey?: string
  colourCount?: number
}

interface Body {
  /** Single-qty mode (legacy). Returns { prices }. */
  qty?: number
  /** Multi-qty mode. Returns { pricesByQty }. Wins if both qty + qtys provided. */
  qtys?: number[]
  items?: Item[]
  /**
   * The catalogue item being priced (one PDP = one item). When provided it is
   * the authoritative source for the manual_final combined decoration figure
   * (matches submit, which keys off the line's catalogue identity). Falls back
   * to reverse-deriving from the decoration links when absent.
   */
  catalogueItemId?: string | null
}

type LinkLookup = {
  decoIdByLink: Map<string, string>
  fallbackByLink: Map<string, number>
  /** b2b_catalogue_items.id each link belongs to — used to resolve the item's
   *  manual_final combined decoration price (one figure for the whole item). */
  catalogueItemIdByLink: Map<string, string>
}

interface CountryPricingOptions {
  enabled: boolean
  currency: string
}

async function loadLinkLookup(admin: SupabaseClient, linkIds: string[]): Promise<LinkLookup> {
  const decoIdByLink = new Map<string, string>()
  const fallbackByLink = new Map<string, number>()
  const catalogueItemIdByLink = new Map<string, string>()
  if (linkIds.length === 0) return { decoIdByLink, fallbackByLink, catalogueItemIdByLink }
  const { data } = await admin
    .from('b2b_catalogue_item_decorations')
    .select('id, org_decoration_id, catalogue_item_id, org_decorations!inner(unit_price)')
    .in('id', linkIds)
  for (const row of data ?? []) {
    const od = Array.isArray((row as { org_decorations: unknown }).org_decorations)
      ? (row as { org_decorations: Array<{ unit_price?: number | string }> }).org_decorations[0]
      : (row as { org_decorations: { unit_price?: number | string } }).org_decorations
    decoIdByLink.set(row.id as string, row.org_decoration_id as string)
    fallbackByLink.set(row.id as string, Number(od?.unit_price ?? 0))
    if ((row as { catalogue_item_id?: string }).catalogue_item_id) {
      catalogueItemIdByLink.set(row.id as string, (row as { catalogue_item_id: string }).catalogue_item_id)
    }
  }
  return { decoIdByLink, fallbackByLink, catalogueItemIdByLink }
}

/**
 * Manual-final combined decoration price for the item, at a given qty. Prefers
 * the explicit `catalogueItemId` (authoritative, matches submit); otherwise
 * reverse-derives it from the decoration links, requiring all links to resolve
 * to a single catalogue item. Returns null for computed items / no matching band
 * (engine returns NULL) — caller then stays on the per-placement path.
 */
async function resolveManualCombined(
  admin: SupabaseClient,
  lookup: LinkLookup,
  linkIds: string[],
  qty: number,
  explicitCatalogueItemId: string | null | undefined,
  countryPricing: CountryPricingOptions,
): Promise<number | null> {
  let catalogueItemId = explicitCatalogueItemId ?? null
  if (!catalogueItemId) {
    const itemIds = new Set<string>()
    for (const id of linkIds) {
      const cid = lookup.catalogueItemIdByLink.get(id)
      if (cid) itemIds.add(cid)
    }
    if (itemIds.size !== 1) return null
    catalogueItemId = [...itemIds][0]
  }
  const { data, error } = countryPricing.enabled
    ? await admin.rpc('catalogue_item_decoration_price_for_currency', {
        p_catalogue_item_id: catalogueItemId,
        p_qty: qty,
        p_currency: countryPricing.currency,
      })
    : await admin.rpc('catalogue_item_decoration_price', {
        p_catalogue_item_id: catalogueItemId,
        p_qty: qty,
      })
  if (error || data == null) return null
  const n = Number(data)
  return Number.isFinite(n) ? n : null
}

async function loadTierMultiplier(admin: SupabaseClient, organizationId: string): Promise<number> {
  const { data } = await admin
    .from('b2b_accounts')
    .select('tier_discount_override, customer_pricing_tiers!inner(multiplier)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return 1
  if (data.tier_discount_override != null) return Number(data.tier_discount_override)
  const tier = Array.isArray(data.customer_pricing_tiers)
    ? data.customer_pricing_tiers[0]
    : data.customer_pricing_tiers
  return Number((tier as { multiplier?: number | string } | null)?.multiplier ?? 1)
}

async function priceLink(
  admin: SupabaseClient,
  qty: number,
  linkId: string,
  lookup: LinkLookup,
  tierMult: number,
  countryPricing: CountryPricingOptions,
): Promise<number | null> {
  const decoId = lookup.decoIdByLink.get(linkId)
  if (!decoId) return null
  const { data, error } = countryPricing.enabled
    ? await admin.rpc('effective_decoration_unit_price_for_currency', {
        p_org_decoration_id: decoId,
        p_qty: qty,
        p_currency: countryPricing.currency,
      })
    : await admin.rpc('effective_decoration_unit_price', {
        p_org_decoration_id: decoId,
        p_qty: qty,
      })
  const base =
    !error && data != null
      ? Number(data)
      : countryPricing.enabled
        ? null
        : (lookup.fallbackByLink.get(linkId) ?? null)
  if (base == null || !Number.isFinite(base)) return null
  return Number((base * tierMult).toFixed(2))
}

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items required' }, { status: 400 })
  }

  const countryPartitionEnabled = isCheckoutCountryPartitionEnabled()
  const defaultCountry = countryPartitionEnabled
    ? await getOrgDefaultBillingCountry(admin, context.organizationId)
    : null
  const countryPricing: CountryPricingOptions = {
    enabled: countryPartitionEnabled,
    currency: defaultCountry?.currency ?? 'NZD',
  }

  const linkIds = body.items.map((i) => i.linkId)
  const [lookup, tierMult] = await Promise.all([
    loadLinkLookup(admin, linkIds),
    loadTierMultiplier(admin, context.organizationId),
  ])

  // Multi-qty mode
  if (Array.isArray(body.qtys) && body.qtys.length > 0) {
    const qtys = body.qtys.filter((q) => Number.isFinite(q) && q >= 1)
    if (qtys.length === 0) {
      return NextResponse.json({ error: 'qtys must contain >= 1 positive integer' }, { status: 400 })
    }

    const pricesByQty: Record<string, Record<string, number | null>> = {}
    // Manual-final: ONE combined decoration figure per qty for the whole item.
    // Non-null only for manual items; null leaves the consumer on the per-link path.
    const manualByQty: Record<string, number | null> = {}
    await Promise.all([
      ...qtys.flatMap((qty) =>
        body.items!.map(async (item) => {
          const price = await priceLink(
            admin,
            qty,
            item.linkId,
            lookup,
            tierMult,
            countryPricing,
          )
          if (!pricesByQty[String(qty)]) pricesByQty[String(qty)] = {}
          pricesByQty[String(qty)][item.linkId] = price
        }),
      ),
      ...qtys.map(async (qty) => {
        manualByQty[String(qty)] = await resolveManualCombined(
          admin,
          lookup,
          linkIds,
          qty,
          body.catalogueItemId,
          countryPricing,
        )
      }),
    ])
    return NextResponse.json({
      pricesByQty,
      manualByQty,
      ...(countryPartitionEnabled ? { currency: countryPricing.currency } : {}),
    })
  }

  // Single-qty mode (legacy)
  if (!body.qty || !Number.isFinite(body.qty) || body.qty < 1) {
    return NextResponse.json({ error: 'qty or qtys must be provided' }, { status: 400 })
  }

  const results = await Promise.all(
    body.items.map(
      async (item) =>
        [
          item.linkId,
          await priceLink(admin, body.qty!, item.linkId, lookup, tierMult, countryPricing),
        ] as const,
    ),
  )
  const prices: Record<string, number | null> = {}
  for (const [linkId, price] of results) prices[linkId] = price
  const manual = await resolveManualCombined(
    admin,
    lookup,
    linkIds,
    body.qty,
    body.catalogueItemId,
    countryPricing,
  )
  return NextResponse.json({
    prices,
    manual,
    ...(countryPartitionEnabled ? { currency: countryPricing.currency } : {}),
  })
}
