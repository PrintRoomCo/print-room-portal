import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

interface Item {
  linkId: string
  placementKey: string
  colourCount: number
}

interface Body {
  /** Single-qty mode (legacy). Returns { prices }. */
  qty?: number
  /** Multi-qty mode. Returns { pricesByQty }. Wins if both qty + qtys provided. */
  qtys?: number[]
  items?: Item[]
}

type LinkLookup = {
  decoIdByLink: Map<string, string>
  fallbackByLink: Map<string, number>
}

async function loadLinkLookup(admin: SupabaseClient, linkIds: string[]): Promise<LinkLookup> {
  const decoIdByLink = new Map<string, string>()
  const fallbackByLink = new Map<string, number>()
  if (linkIds.length === 0) return { decoIdByLink, fallbackByLink }
  const { data } = await admin
    .from('b2b_catalogue_item_decorations')
    .select('id, org_decoration_id, org_decorations!inner(unit_price)')
    .in('id', linkIds)
  for (const row of data ?? []) {
    const od = Array.isArray((row as { org_decorations: unknown }).org_decorations)
      ? (row as { org_decorations: Array<{ unit_price?: number | string }> }).org_decorations[0]
      : (row as { org_decorations: { unit_price?: number | string } }).org_decorations
    decoIdByLink.set(row.id as string, row.org_decoration_id as string)
    fallbackByLink.set(row.id as string, Number(od?.unit_price ?? 0))
  }
  return { decoIdByLink, fallbackByLink }
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
): Promise<number | null> {
  const decoId = lookup.decoIdByLink.get(linkId)
  if (!decoId) return null
  const { data, error } = await admin.rpc('effective_decoration_unit_price', {
    p_org_decoration_id: decoId,
    p_qty: qty,
  })
  const base =
    !error && data != null
      ? Number(data)
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
    await Promise.all(
      qtys.flatMap((qty) =>
        body.items!.map(async (item) => {
          const price = await priceLink(admin, qty, item.linkId, lookup, tierMult)
          if (!pricesByQty[String(qty)]) pricesByQty[String(qty)] = {}
          pricesByQty[String(qty)][item.linkId] = price
        }),
      ),
    )
    return NextResponse.json({ pricesByQty })
  }

  // Single-qty mode (legacy)
  if (!body.qty || !Number.isFinite(body.qty) || body.qty < 1) {
    return NextResponse.json({ error: 'qty or qtys must be provided' }, { status: 400 })
  }

  const results = await Promise.all(
    body.items.map(async (item) => [item.linkId, await priceLink(admin, body.qty!, item.linkId, lookup, tierMult)] as const),
  )
  const prices: Record<string, number | null> = {}
  for (const [linkId, price] of results) prices[linkId] = price
  return NextResponse.json({ prices })
}
