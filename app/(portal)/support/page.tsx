import type { Metadata } from 'next'
import { getPortalCompanyAccess } from '@/lib/portal-data'
import { CustomerSupportPageContent } from './SupportPageContent'

export const metadata: Metadata = {
  title: 'Support',
}

export default async function SupportPage() {
  const access = await getPortalCompanyAccess()

  return (
    <CustomerSupportPageContent
      access={{
        isCompanyUser: access?.isCompanyUser ?? false,
        isOrgAdmin: access?.isOrgAdmin ?? false,
      }}
    />
  )
}
