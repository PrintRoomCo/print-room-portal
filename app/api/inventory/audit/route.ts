import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { getInventoryAuditEntries } from '@/lib/inventory/audit-feed'

export async function GET() {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  // Org-admin only (rename-independent — org_admin keeps its value).
  if (auth.context.role !== 'org_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { entries, error } = await getInventoryAuditEntries(
    auth.admin,
    auth.context.organizationId,
  )
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ entries })
}
