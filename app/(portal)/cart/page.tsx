import { redirect } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { CartClient } from '@/components/cart/CartClient'

export const dynamic = 'force-dynamic'

export default async function CartPage() {
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { context } = auth

  return (
    <CartClient
      defaultDepositPercent={context.defaultDepositPercent}
      paymentTerms={context.paymentTerms}
      customerCodeMissing={!context.customerCode}
    />
  )
}
