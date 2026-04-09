'use client'

import type { JobTracker } from '@/lib/job-tracker'

const COMPLETED_STATUSES = ['dispatched', 'delivered', 'complete', 'fulfilled']

function isCompleted(status: string): boolean {
  const normalized = status.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return COMPLETED_STATUSES.some((s) => normalized.includes(s))
}

interface TrackerSummaryCardsProps {
  trackers: JobTracker[]
  isCompanyWide?: boolean
}

export function TrackerSummaryCards({ trackers, isCompanyWide }: TrackerSummaryCardsProps) {
  const total = trackers.length
  const completed = trackers.filter((t) => isCompleted(t.status)).length
  const active = total - completed

  const proofAwaitingCount = isCompanyWide
    ? trackers.filter((t) => {
        const normalized = t.status.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        return normalized === 'proof-sent'
      }).length
    : null

  return (
    <div className={`grid gap-4 ${isCompanyWide ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
      <SummaryCard label="Active" value={active} color="primary" />
      {proofAwaitingCount !== null && (
        <SummaryCard label="Awaiting Proof" value={proofAwaitingCount} color="yellow" />
      )}
      <SummaryCard label="Completed" value={completed} color="blue" />
      <SummaryCard label="Total" value={total} color="gray" />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: 'primary' | 'blue' | 'yellow' | 'gray'
}) {
  const colorClasses = {
    primary: 'text-[rgb(var(--color-primary))]',
    blue: 'text-[rgb(var(--color-brand-blue))]',
    yellow: 'text-yellow-600',
    gray: 'text-gray-600',
  }

  return (
    <div className="card-elevated p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorClasses[color]}`}>{value}</p>
    </div>
  )
}
