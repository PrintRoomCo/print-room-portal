import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

interface Item {
  linkId: string
  placementKey: string
  colourCount: number
}

interface Body {
  qty?: number
  items?: Item[]
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
  if (!body.qty || !Number.isFinite(body.qty) || body.qty < 1) {
    return NextResponse.json({ error: 'qty must be >= 1' }, { status: 400 })
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items required' }, { status: 400 })
  }

  const results = await Promise.all(
    body.items.map(async (item) => {
      const { data, error } = await admin.rpc('calculate_screenprint_pricing_api', {
        args: {
          qty: body.qty,
          placements: [{ placement: item.placementKey, colors: item.colourCount }],
          currency: 'NZD',
        },
      })
      if (error) return [item.linkId, null] as const
      const row = Array.isArray(data) ? data[0] : data
      const unitPrice = row?.per_placement_costs?.[0]?.unit_price
      return [
        item.linkId,
        unitPrice != null ? Number(unitPrice) : null,
      ] as const
    }),
  )

  const prices: Record<string, number | null> = {}
  for (const [linkId, price] of results) prices[linkId] = price
  return NextResponse.json({ prices })
}
