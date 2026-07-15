import type { Metadata } from 'next'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { CheckoutReviewClient } from '@/components/checkout/CheckoutReviewClient'
import type { StoreOption } from '@/components/checkout/ShipToRow'

export const metadata: Metadata = {
  title: 'Review order',
}

export default async function CheckoutReviewPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  const { data: rawStores } = await admin
    .from('stores')
    .select('id, name, city, country')
    .eq('organization_id', context.organizationId)
    .order('name')

  const stores = ((rawStores ?? []) as StoreOption[]) ?? []

  return (
    <CheckoutReviewClient
      stores={stores}
      customerCode={context.customerCode}
      paymentTerms={context.paymentTerms}
      defaultDepositPercent={context.defaultDepositPercent}
      isTest={context.isTest}
    />
  )
}
