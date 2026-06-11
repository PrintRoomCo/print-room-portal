import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

export async function GET() {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  const orgId = context.organizationId
  const role = context.role

  const { data, error } = await admin.rpc('period_progress_for_org', {
    p_org_id: orgId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    period_id: string
    closes_at: string
    catalogue_item_id: string
    agg_qty: number
    current_unit_price: number | null
    next_min_quantity: number | null
    next_unit_price: number | null
  }
  const rows = (data ?? []) as Row[]
  const isOrgAdmin = role === 'org_admin'

  return NextResponse.json({
    period: rows[0]
      ? { id: rows[0].period_id, closesAt: rows[0].closes_at }
      : null,
    items: rows.map((r) => ({
      catalogueItemId: r.catalogue_item_id,
      // Raw network aggregates are org_admin-only (spec §3.7);
      // staff get the price-break story without the counts.
      aggQty: isOrgAdmin ? r.agg_qty : null,
      unitsToNextBreak:
        r.next_min_quantity != null ? r.next_min_quantity - r.agg_qty : null,
      currentUnitPrice: r.current_unit_price,
      nextUnitPrice: r.next_unit_price,
    })),
  })
}
