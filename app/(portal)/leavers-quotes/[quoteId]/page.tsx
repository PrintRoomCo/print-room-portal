import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { QuoteDetail } from '@/components/leavers-admin/QuoteDetail'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const metadata = {
  title: 'Quote Detail — The Print Room Portal',
}

interface Props {
  params: Promise<{ quoteId: string }>
}

export default async function LeaversQuoteDetailPage({ params }: Props) {
  const { quoteId } = await params
  const supabase = await getSupabaseServerComponent()

  const { data: quote, error } = await supabase
    .from('quotes')
    .select(`
      *,
      leavers_quote_details (*)
    `)
    .eq('id', quoteId)
    .eq('platform', 'leavers')
    .single()

  if (error || !quote) {
    notFound()
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/leavers-quotes" className="btn-ghost text-sm mb-3 inline-flex items-center gap-1">
          &larr; Back to list
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Quote #{quote.quote_number}</h1>
          <StatusBadgeServer status={quote.status} />
        </div>
      </div>
      <QuoteDetail quote={quote} />
    </div>
  )
}

function StatusBadgeServer({ status }: { status: string }) {
  const classMap: Record<string, string> = {
    pending: 'glass-badge-yellow',
    approved: 'glass-badge-green',
    rejected: 'glass-badge-red',
    completed: 'glass-badge-blue',
  }
  return (
    <span className={classMap[status] || 'glass-badge-gray'}>
      {status}
    </span>
  )
}
