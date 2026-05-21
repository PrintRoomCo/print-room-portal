import type { Metadata } from 'next'
import { MyCollectionsClient } from './MyCollectionsClient'
import { getPortalAccountData } from '@/lib/portal-data'

export const metadata: Metadata = {
  title: 'My collections',
}

export default async function MyCollectionsPage() {
  const initialData = await getPortalAccountData()
  return <MyCollectionsClient initialData={initialData} />
}
