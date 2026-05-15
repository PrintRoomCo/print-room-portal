import { OrderTrackerClient } from './OrderTrackerClient'
import { getPortalOrderTrackerData } from '@/lib/portal-data'

export const dynamic = 'force-dynamic'

export default async function OrderTrackerPage() {
  const initialData = await getPortalOrderTrackerData()
  return <OrderTrackerClient initialData={initialData} />
}
