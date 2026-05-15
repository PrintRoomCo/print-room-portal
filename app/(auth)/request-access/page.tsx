import type { Metadata } from 'next'
import RequestAccessClient from './RequestAccessClient'

export const metadata: Metadata = {
  title: 'Request access',
}

export default function RequestAccessPage() {
  return <RequestAccessClient />
}
