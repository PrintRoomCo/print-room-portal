import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ stores: [], recentQuotes: [] })
  }

  const adminClient = getSupabaseServer()

  // Get organization membership
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  let stores: any[] = []
  let recentQuotes: any[] = []

  if (membership) {
    // Fetch company stores
    const { data: storesData } = await adminClient
      .from('stores')
      .select('id, name, address, location, city, state, country, postal_code, phone')
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: true })

    stores = storesData || []

    // Fetch quotes for the company
    const { data: quotesData } = await adminClient
      .from('quotes')
      .select('id, reference, quote_number, status, customer_name, customer_email, customer_company, subtotal, total_amount, currency, source, created_at')
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: false })

    recentQuotes = quotesData || []
  } else {
    // Individual user — fetch quotes by email
    const { data: quotesData } = await adminClient
      .from('quotes')
      .select('id, reference, quote_number, status, customer_name, customer_email, customer_company, subtotal, total_amount, currency, source, created_at')
      .eq('customer_email', user.email)
      .order('created_at', { ascending: false })

    recentQuotes = quotesData || []
  }

  return NextResponse.json({ stores, recentQuotes })
}
