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
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12 flex items-end justify-between gap-4">
          <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Leavers Quotes
          </h1>
          <span className="glass-badge-blue">{quotes?.length || 0} quotes</span>
        </header>
        <QuoteList quotes={quotes || []} />
      </div>
    </div>
  )
}
