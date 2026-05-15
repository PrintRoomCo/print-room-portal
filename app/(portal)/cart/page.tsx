import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cart',
}

export default async function CartPage() {
  redirect('/catalogue')
}
