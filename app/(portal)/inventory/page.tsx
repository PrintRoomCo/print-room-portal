import { redirect } from 'next/navigation'
import { getPortalUser, getPortalCompanyAccess } from '@/lib/portal-data'
import { getSupabaseServer } from '@/lib/supabase'
import { getCustomerInventoryRows } from '@/lib/inventory/customer-rows'
import { InventoryClient } from './InventoryClient'

const INVENTORY_TENANTS = ['franchise', 'studio_plus_inventory'] as const

export default async function InventoryPage() {
  // Reuse the layout's request-cached identity/access (no extra auth call).
  const user = await getPortalUser()
  if (!user) redirect('/sign-in')

  const access = await getPortalCompanyAccess()
  const tenant = access?.tenantType
  const allowed =
    !!access &&
    access.isOrgAdmin &&
    !!tenant &&
    (INVENTORY_TENANTS as ReadonlyArray<string>).includes(tenant)
  if (!allowed || !access.companyId) redirect('/catalogue')

  // Server-render the stock rows so the page paints with data — no blank shell ->
  // client fetch -> spinner waterfall. (The stock-movement audit feed was removed
  // from the customer view; the /api/inventory/audit route still serves it.)
  const admin = getSupabaseServer()
  const rows = await getCustomerInventoryRows(admin, access.companyId)

  return <InventoryClient rows={rows} />
}
