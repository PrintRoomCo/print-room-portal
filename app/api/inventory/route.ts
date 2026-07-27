import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { getCustomerInventoryRows } from '@/lib/inventory/customer-rows'

// Re-exported for existing consumers (InventoryClient imports the type from here).
export type { CustomerInventoryRow } from '@/lib/inventory/customer-rows'

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ rows: [] }, { status: 401 })
  }

  const adminClient = getSupabaseServer()

  // Resolve organization_id directly — lighter than getCompanyAccess() which
  // pulls profile/org/b2b_account/stores. Mirrors app/api/order-tracker/route.ts.
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  const organizationId = membership?.organization_id
  if (!organizationId) {
    return NextResponse.json({ rows: [] })
  }

  const rows = await getCustomerInventoryRows(adminClient, organizationId)
  return NextResponse.json({ rows })
}
