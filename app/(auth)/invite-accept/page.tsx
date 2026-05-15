import type { Metadata } from 'next'
import InviteAcceptClient from './InviteAcceptClient'

export const metadata: Metadata = {
  title: 'Accept invite',
}

export default function InviteAcceptPage() {
  return <InviteAcceptClient />
}
