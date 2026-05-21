import type { Metadata } from 'next'
import { OrderTrackerClient } from './OrderTrackerClient'
import { getPortalOrderTrackerData } from '@/lib/portal-data'

export const metadata: Metadata = {
  title: 'Order tracker',
}

export default async function OrderTrackerPage() {
  const initialData = await getPortalOrderTrackerData()
  return <OrderTrackerClient initialData={initialData} />
}
