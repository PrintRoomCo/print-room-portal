import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { OrderTrackerClient } from './OrderTrackerClient'
import { getPortalOrderTrackerData, getPortalCompanyAccess } from '@/lib/portal-data'

export const metadata: Metadata = {
  title: 'Past orders',
}

export default async function OrderTrackerPage() {
  // Item 5: tracker is admin-only. Nav-hide is not enough — block direct URLs.
  // /past-orders (canonical) and /tracking (legacy redirect) re-export this
  // default, so they are covered too.
  const access = await getPortalCompanyAccess()
  if (!access) redirect('/sign-in')
  if (!access.isOrgAdmin) redirect('/my-collections')

  const initialData = await getPortalOrderTrackerData()
  return <OrderTrackerClient initialData={initialData} />
}
