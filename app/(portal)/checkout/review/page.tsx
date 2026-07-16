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

  const [{ data: rawStores }, { data: billingRows }] = await Promise.all([
    admin
      .from('stores')
      .select('id, name, city, country')
      .eq('organization_id', context.organizationId)
      .order('name'),
    // Fresh billing_mode per catalogue item — the cart's snapshot can go stale
    // if staff flip an item's billing while it sits in a persisted cart. The
    // server bills from this value at submit, so the review badge must match.
    admin
      .from('b2b_catalogue_items')
      .select('id, billing_mode, b2b_catalogues!inner(organization_id, is_active)')
      .eq('b2b_catalogues.organization_id', context.organizationId)
      .eq('b2b_catalogues.is_active', true),
  ])

  const stores = ((rawStores ?? []) as StoreOption[]) ?? []
  const billingModeByItemId = Object.fromEntries(
    ((billingRows ?? []) as Array<{ id: string; billing_mode: string | null }>).map((r) => [
      r.id,
      (r.billing_mode ?? 'invoice_on_dispatch') as 'invoice_on_dispatch' | 'prepaid',
    ]),
  )

  return (
    <CheckoutReviewClient
      stores={stores}
      customerCode={context.customerCode}
      paymentTerms={context.paymentTerms}
      defaultDepositPercent={context.defaultDepositPercent}
      isTest={context.isTest}
      billingModeByItemId={billingModeByItemId}
    />
  )
}
