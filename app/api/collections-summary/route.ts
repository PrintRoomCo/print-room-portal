import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return NextResponse.json({ activeQuotes: 0, expiredQuotes: 0 })
  }

  const adminClient = getSupabaseServer()

  // Get organization membership to determine query scope
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  let quotesQuery = adminClient
    .from('quotes')
    .select('status, source')

  if (membership?.organization_id) {
    quotesQuery = quotesQuery.eq('organization_id', membership.organization_id)
  } else {
    quotesQuery = quotesQuery.eq('customer_email', user.email.toLowerCase())
  }

  const { data: quotes } = await quotesQuery

  // Filter out design-collection-linked quotes
  const standaloneQuotes = (quotes || []).filter(
    (q) => q.source !== 'b2b-portal-design-collection'
  )

  const activeQuotes = standaloneQuotes.filter((q) => q.status !== 'expired').length
  const expiredQuotes = standaloneQuotes.filter((q) => q.status === 'expired').length

  return NextResponse.json({ activeQuotes, expiredQuotes })
}
