import type { Metadata } from 'next'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { CheckoutClient } from '@/components/checkout/CheckoutClient'
import type { StoreOption } from '@/components/checkout/ShipToRow'
import { getOrgEnabledCountries } from '@/lib/account/org-countries'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'

export const metadata: Metadata = {
  title: 'Checkout',
}

export default async function CheckoutPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  const { data: rawStores } = await admin
    .from('stores')
    // `country` region-gates the NZ picking fee. The review page has always
    // selected it; omitting it here would quote a $0 fee on /checkout and $15 on
    // /checkout/review — the exact divergence this page is being fixed for.
    .select('id, name, city, country')
    .eq('organization_id', context.organizationId)
    .order('name')

  const stores = ((rawStores ?? []) as StoreOption[]) ?? []
  const enabledCountries = await getOrgEnabledCountries(admin, context.organizationId)

  return (
    <CheckoutClient
      stores={stores}
      customerCode={context.customerCode}
      paymentTerms={context.paymentTerms}
      defaultDepositPercent={context.defaultDepositPercent}
      isTest={context.isTest}
      defaultStoreId={context.defaultStoreId}
      isBuyer={context.role === 'staff'}
      tenantType={context.tenantType}
      enabledCountries={enabledCountries}
      defaultPriceCurrency={enabledCountries.find((country) => country.isDefault)?.currency ?? null}
      countryPartitionEnabled={isCheckoutCountryPartitionEnabled()}
    />
  )
}
