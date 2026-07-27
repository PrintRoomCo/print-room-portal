import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPortalUser } from '@/lib/portal-data'
import { getSupabaseServer } from '@/lib/supabase'
import {
  mapPastOrderRow,
  queryPastOrders,
  type PortalPastOrder,
} from '@/lib/orders/past-orders-query'
import { getMemberBranchStoreIds } from '@/lib/orders/branch-grants'
import { filterPastOrders } from '@/lib/orders/past-orders-filter'
import {
  buildLineItemsCsv,
  buildOrdersCsv,
  type PastOrderLineItem,
} from '@/lib/orders/past-orders-csv'

// An export must reflect the DB now, never the list cache.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const granularity = params.get('granularity')
  if (granularity !== 'order' && granularity !== 'line') {
    return NextResponse.json({ error: 'granularity must be "order" or "line"' }, { status: 400 })
  }

  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = getSupabaseServer()
  // Org id comes from the session-derived membership only — request params can
  // narrow the scoped set but never choose the org (service-role client, so
  // this scoping is the security boundary).
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('id, organization_id, role, default_store_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership?.organization_id) {
    return NextResponse.json({ error: 'No organisation membership' }, { status: 403 })
  }

  const branchStoreIds =
    membership.role === 'org_admin'
      ? []
      : await getMemberBranchStoreIds(adminClient, membership.id, membership.default_store_id ?? null)
  const rows = await queryPastOrders(adminClient, {
    organizationId: membership.organization_id,
    canSeeAllOrgOrders: membership.role === 'org_admin',
    userEmail: user.email ?? null,
    branchStoreIds,
  })

  const orders = filterPastOrders(rows.map(mapPastOrderRow), {
    status: params.get('status') ?? 'all',
    from: params.get('from'),
    to: params.get('to'),
  })

  const csv =
    granularity === 'order'
      ? buildOrdersCsv(orders)
      : await buildLineCsv(adminClient, membership.organization_id, orders)

  const orgCode = rows[0]?.quotes?.customer_code ?? 'export'
  const today = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${orgCode}-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

async function buildLineCsv(
  adminClient: SupabaseClient,
  organizationId: string,
  orders: PortalPastOrder[],
): Promise<string> {
  const quoteIds = orders.map((o) => o.quoteId).filter(Boolean) as string[]

  const [itemsResult, storesResult] = await Promise.all([
    quoteIds.length
      ? adminClient
          .from('quote_items')
          .select(
            'quote_id, product_name, size_label, quantity, unit_price, total_price, qty_from_stock, qty_to_make, ship_to_store_id',
          )
          .in('quote_id', quoteIds)
      : Promise.resolve({ data: [] as PastOrderLineItem[], error: null }),
    adminClient.from('stores').select('id, name').eq('organization_id', organizationId),
  ])

  const itemsByQuoteId = new Map<string, PastOrderLineItem[]>()
  for (const item of (itemsResult.data ?? []) as PastOrderLineItem[]) {
    if (!item.quote_id) continue
    const bucket = itemsByQuoteId.get(item.quote_id) ?? []
    bucket.push(item)
    itemsByQuoteId.set(item.quote_id, bucket)
  }

  const storeNameById = new Map<string, string>(
    ((storesResult.data ?? []) as Array<{ id: string; name: string | null }>).map((s) => [
      s.id,
      s.name ?? s.id,
    ]),
  )

  return buildLineItemsCsv(orders, itemsByQuoteId, storeNameById)
}
