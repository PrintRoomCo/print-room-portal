import type { Metadata } from 'next'
import { MyCollectionsClient } from './MyCollectionsClient'
import { getPortalPastOrdersData } from '@/lib/portal-data'

export const metadata: Metadata = {
  title: 'My collections',
}

export default async function MyCollectionsPage() {
  const initialData = await getPortalPastOrdersData()
  return <MyCollectionsClient initialData={initialData} />
}
