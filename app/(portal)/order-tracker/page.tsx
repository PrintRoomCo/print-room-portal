import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { OrderTrackerClient } from './OrderTrackerClient'
import { getPortalOrderTrackerData, getPortalCompanyAccess } from '@/lib/portal-data'

export const metadata: Metadata = {
  title: 'Current Orders',
}

export default async function OrderTrackerPage() {
  // Item 5: tracker is admin-only. Nav-hide is not enough — block direct URLs.
  // /current-orders (canonical) and /past-orders + /tracking (legacy redirects)
  // default, so they are covered too.
  const access = await getPortalCompanyAccess()
  if (!access) redirect('/sign-in')
  if (!access.isOrgAdmin) redirect('/past-orders')

  const initialData = await getPortalOrderTrackerData()
  return <OrderTrackerClient initialData={initialData} />
}
