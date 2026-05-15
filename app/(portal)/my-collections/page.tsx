import { MyCollectionsClient } from './MyCollectionsClient'
import { getPortalAccountData } from '@/lib/portal-data'

export const dynamic = 'force-dynamic'

export default async function MyCollectionsPage() {
  const initialData = await getPortalAccountData()
  return <MyCollectionsClient initialData={initialData} />
}
