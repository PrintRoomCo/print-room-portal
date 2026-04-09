import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return NextResponse.json({
      totalQuotes: 0,
      submittedQuotes: 0,
      totalValue: 0,
      activeCollections: 0,
    })
  }

  const adminClient = getSupabaseServer()
  const email = user.email.toLowerCase()

  // Get organization membership to determine query scope
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  let quotesQuery = adminClient
    .from('quotes')
    .select('status, total_amount, source')

  if (membership?.organization_id) {
    quotesQuery = quotesQuery.eq('organization_id', membership.organization_id)
  } else {
    quotesQuery = quotesQuery.eq('customer_email', email)
  }

  const { data: quotes } = await quotesQuery

  // Filter out design-collection-linked quotes for standalone count
  const standaloneQuotes = (quotes || []).filter(
    (q) => q.source !== 'b2b-portal-design-collection'
  )

  const totalQuotes = standaloneQuotes.length
  const submittedQuotes = standaloneQuotes.filter(
    (q) => q.status === 'submitted'
  ).length
  const totalValue = standaloneQuotes.reduce(
    (sum, q) => sum + Number(q.total_amount || 0),
    0
  )

  // Count active collections
  const { count: activeCollections } = await adminClient
    .from('design_collections')
    .select('*', { count: 'exact', head: true })
    .eq('customer_email', email)
    .in('status', ['draft', 'submitted'])

  return NextResponse.json({
    totalQuotes,
    submittedQuotes,
    totalValue,
    activeCollections: activeCollections || 0,
  })
}
