'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { StatusBadge } from './StatusBadge'

interface Quote {
  id: string
  quote_number: string
  status: string
  customer_name: string
  customer_email: string
  customer_company: string
  total_amount: number
  created_at: string
  monday_item_id: string | null
  leavers_quote_details: Array<{
    school_name: string
    teacher_name: string
    ordering_method: string
  }>
}

interface Props {
  quotes: Quote[]
}

export function QuoteList({ quotes }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const filtered = useMemo(() => {
    return quotes.filter(q => {
      if (statusFilter !== 'all' && q.status !== statusFilter) return false
      if (search) {
        const term = search.toLowerCase()
        const schoolName = q.leavers_quote_details?.[0]?.school_name || ''
        return (
          q.quote_number.toLowerCase().includes(term) ||
          q.customer_name.toLowerCase().includes(term) ||
          q.customer_email.toLowerCase().includes(term) ||
          schoolName.toLowerCase().includes(term)
        )
      }
      return true
    })
  }, [quotes, search, statusFilter])

  const statuses = ['all', ...new Set(quotes.map(q => q.status))]

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          className="input-glass max-w-xs"
          placeholder="Search by name, school, quote #..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-1">
          {statuses.map(s => (
            <button
              key={s}
              className={`filter-tab ${statusFilter === s ? 'filter-tab-active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Quote cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {quotes.length === 0 ? 'No leavers quotes yet.' : 'No quotes match your filters.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(q => {
            const details = q.leavers_quote_details?.[0]
            return (
              <Link key={q.id} href={`/leavers-quotes/${q.id}`} className="card-interactive p-4 flex items-center justify-between gap-4 block">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{q.quote_number}</span>
                    <StatusBadge status={q.status} />
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {details?.school_name || q.customer_company || q.customer_name}
                    {details?.teacher_name && ` — ${details.teacher_name}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(q.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {details?.ordering_method && ` · ${details.ordering_method === 'online_store' ? 'Online Store' : 'Spreadsheet'}`}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-lg">${Number(q.total_amount).toFixed(2)}</div>
                  {q.monday_item_id && (
                    <span className="glass-badge-gray text-[10px]">Monday</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
