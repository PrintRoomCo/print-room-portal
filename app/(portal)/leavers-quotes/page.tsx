import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { QuoteList } from '@/components/leavers-admin/QuoteList'

export const metadata = {
  title: 'Leavers Quotes — The Print Room Portal',
}

export default async function LeaversQuotesPage() {
  const supabase = await getSupabaseServerComponent()

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select(`
      id, quote_number, status, customer_name, customer_email, customer_company,
      total_amount, created_at, monday_item_id,
      leavers_quote_details (school_name, teacher_name, ordering_method)
    `)
    .eq('platform', 'leavers')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('Failed to fetch leavers quotes:', error.message)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Leavers Quotes</h1>
        <span className="glass-badge-blue">{quotes?.length || 0} quotes</span>
      </div>
      <QuoteList quotes={quotes || []} />
    </div>
  )
}
