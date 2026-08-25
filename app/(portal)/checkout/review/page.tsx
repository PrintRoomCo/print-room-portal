import type { Metadata } from 'next'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { CheckoutReviewClient } from '@/components/checkout/CheckoutReviewClient'
import type { StoreOption } from '@/components/checkout/ShipToRow'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import { getOrgDefaultBillingCountry } from '@/lib/account/org-countries'

export const metadata: Metadata = {
  title: 'Review order',
}

export default async function CheckoutReviewPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  // Spec 3a: billing is per VARIANT and rides the cart line's own billingMode
  // snapshot (set from variant_inventory.billing_mode on the PDP), so the
  // item-level billing fetch is gone.
  const { data: rawStores } = await admin
    .from('stores')
    .select('id, name, city, country')
    .eq('organization_id', context.organizationId)
    .order('name')

  const stores = ((rawStores ?? []) as StoreOption[]) ?? []
  const countryPartitionEnabled = isCheckoutCountryPartitionEnabled()
  const defaultCountry = countryPartitionEnabled
    ? await getOrgDefaultBillingCountry(admin, context.organizationId)
    : null

  return (
    <CheckoutReviewClient
      stores={stores}
      customerCode={context.customerCode}
      paymentTerms={context.paymentTerms}
      defaultDepositPercent={context.defaultDepositPercent}
      isTest={context.isTest}
      role={context.role}
      branchStoreIds={context.branchStoreIds}
      defaultStoreId={context.defaultStoreId}
      defaultPriceCurrency={defaultCountry?.currency ?? null}
      countryPartitionEnabled={countryPartitionEnabled}
    />
  )
}
