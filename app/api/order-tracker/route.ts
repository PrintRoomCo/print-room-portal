import { NextResponse } from 'next/server'
import { getPortalCompanyAccess, getPortalOrderTrackerData } from '@/lib/portal-data'

export async function GET() {
  const access = await getPortalCompanyAccess()
  if (!access) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!access.isOrgAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(await getPortalOrderTrackerData())
}
