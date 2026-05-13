import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { CheckoutClient } from '@/components/checkout/CheckoutClient'
import type { StoreOption } from '@/components/checkout/ShipToRow'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
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
      defaultStoreId={context.defaultStoreId}
      isBuyer={context.role === 'buyer'}
      tenantType={context.tenantType}
    />
  )
}
