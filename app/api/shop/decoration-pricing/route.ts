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

async function priceItem(
  admin: SupabaseClient,
  qty: number,
  item: Item,
): Promise<number | null> {
  const { data, error } = await admin.rpc('calculate_screenprint_pricing_api', {
    args: {
      qty,
      placements: [{ placement: item.placementKey, colors: item.colourCount }],
      currency: 'NZD',
    },
  })
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  const unitPrice = (row as { per_placement_costs?: Array<{ unit_price?: number | string }> } | null)
    ?.per_placement_costs?.[0]?.unit_price
  return unitPrice != null ? Number(unitPrice) : null
}

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin } = auth

  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items required' }, { status: 400 })
  }

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
          const price = await priceItem(admin, qty, item)
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
    body.items.map(async (item) => [item.linkId, await priceItem(admin, body.qty!, item)] as const),
  )
  const prices: Record<string, number | null> = {}
  for (const [linkId, price] of results) prices[linkId] = price
  return NextResponse.json({ prices })
}
