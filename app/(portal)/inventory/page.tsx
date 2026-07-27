import { redirect } from 'next/navigation'
import { getPortalUser, getPortalCompanyAccess } from '@/lib/portal-data'
import { getSupabaseServer } from '@/lib/supabase'
import { getCustomerInventoryRows } from '@/lib/inventory/customer-rows'
import { getInventoryAuditEntries } from '@/lib/inventory/audit-feed'
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

  // Server-render both datasets (in parallel) so the page paints with data —
  // no more blank shell -> client fetch -> spinner waterfall.
  const admin = getSupabaseServer()
  const [rows, audit] = await Promise.all([
    getCustomerInventoryRows(admin, access.companyId),
    getInventoryAuditEntries(admin, access.companyId),
  ])

  return <InventoryClient rows={rows} entries={audit.entries} />
}
