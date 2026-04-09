import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { getCollectionWithDesigns, getAvailableDesigns, getCollectionByQuoteId } from '@/lib/collections-detail'
import { getLatestJobTrackerByQuoteId } from '@/lib/job-tracker-queries'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params

  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const email = user.email.toLowerCase()
  const adminClient = getSupabaseServer()

  // Try quote branch first
  const { data: quote } = await adminClient
    .from('quotes')
    .select('*')
    .eq('id', collectionId)
    .single()

  if (quote && quote.customer_email?.toLowerCase() === email) {
    const [linkedCollection, tracker] = await Promise.all([
      getCollectionByQuoteId(quote.id),
      getLatestJobTrackerByQuoteId(quote.id),
    ])

    return NextResponse.json({
      mode: 'quote',
      quote,
      linkedCollection,
      tracker,
    })
  }

  // Collection branch
  const collection = await getCollectionWithDesigns(collectionId)
  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (collection.customer_email.toLowerCase() !== email) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const availableDesigns = await getAvailableDesigns(email)

  // Check for linked tracker (for approved collections)
  let tracker = null
  if (collection.quote_id) {
    tracker = await getLatestJobTrackerByQuoteId(collection.quote_id)
  }

  return NextResponse.json({
    mode: 'collection',
    collection,
    availableDesigns,
    tracker,
  })
}
