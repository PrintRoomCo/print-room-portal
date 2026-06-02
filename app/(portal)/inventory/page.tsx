import { redirect } from 'next/navigation'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getCompanyAccess } from '@/lib/company'
import { InventoryClient } from './InventoryClient'

const INVENTORY_TENANTS = ['franchise', 'studio_plus_inventory'] as const

export default async function InventoryPage() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const access = await getCompanyAccess(user.id, user.email ?? undefined)
  const tenant = access?.tenantType
  const allowed =
    !!access &&
    access.isOrgAdmin &&
    !!tenant &&
    (INVENTORY_TENANTS as ReadonlyArray<string>).includes(tenant)
  if (!allowed) redirect('/catalogue')

  return <InventoryClient />
}
