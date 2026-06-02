import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalTrackerByToken } from '@/lib/portal-data'
import { SingleTrackerClient } from './SingleTrackerClient'

export const metadata: Metadata = {
  title: 'Order tracker',
}

export default async function SingleOrderTrackerPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const tracker = await getPortalTrackerByToken(token)

  // Unknown token OR not owned by this user → portal 404 (never a Vercel 404).
  if (!tracker) notFound()

  return <SingleTrackerClient tracker={tracker} />
}
