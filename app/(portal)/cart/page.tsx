import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PeriodSavingsBar } from './PeriodSavingsBar'

export const metadata: Metadata = {
  title: 'Cart',
}

export default async function CartPage() {
  redirect('/catalogue')
  // PeriodSavingsBar mounts above the cart summary when the redirect is removed.
  // cartCatalogueItemIds is supplied empty here; a client-side cart page would
  // pass cart.lines.map(l => l.catalogueItemId).filter(Boolean) instead.
  return (
    <>
      <PeriodSavingsBar cartCatalogueItemIds={[]} />
    </>
  )
}
