import type { Metadata } from 'next'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { CartClient } from '@/components/cart/CartClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cart',
}

export default async function CartPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { context } = auth

  return (
    <CartClient
      defaultDepositPercent={context.defaultDepositPercent}
      paymentTerms={context.paymentTerms}
      customerCodeMissing={!context.customerCode}
    />
  )
}
