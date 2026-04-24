import { redirect } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { CheckoutClient } from '@/components/checkout/CheckoutClient'
import type { StoreOption } from '@/components/checkout/ShipToRow'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { admin, context } = auth

  const { data: rawStores } = await admin
    .from('stores')
    .select('id, name, city')
    .eq('organization_id', context.organizationId)
    .order('name')

  const stores = ((rawStores ?? []) as StoreOption[]) ?? []

  return (
    <CheckoutClient
      stores={stores}
      customerCode={context.customerCode}
      paymentTerms={context.paymentTerms}
      defaultDepositPercent={context.defaultDepositPercent}
    />
  )
}
