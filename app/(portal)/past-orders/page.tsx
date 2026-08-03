import type { Metadata } from 'next'
import { PastOrdersClient } from './PastOrdersClient'
import { getPortalPastOrdersData } from '@/lib/portal-data'

export const metadata: Metadata = {
  title: 'Past orders',
}

export default async function PastOrdersPage() {
  const initialData = await getPortalPastOrdersData()
  return <PastOrdersClient initialData={initialData} />
}
