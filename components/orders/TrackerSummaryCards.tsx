'use client'

import { isTrackerCompleted, type JobTracker } from '@/lib/job-tracker'

interface TrackerSummaryCardsProps {
  trackers: JobTracker[]
  isCompanyWide?: boolean
}

export function TrackerSummaryCards({ trackers, isCompanyWide }: TrackerSummaryCardsProps) {
  const total = trackers.length
  const completed = trackers.filter((t) => isTrackerCompleted(t.status)).length
  const active = total - completed

  const proofAwaitingCount = isCompanyWide
    ? trackers.filter((t) => {
        // Guard null: Monday-synced trackers can exist with no status yet, and
        // an org-wide list pulls them in via the member user_id arm. Mirrors the
        // null guard in isTrackerCompleted — without it this crashed the whole
        // org-admin "Past orders" page.
        const normalized = (t.status ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
        return normalized === 'proof-sent'
      }).length
    : null

  return (
    <div className={`grid gap-4 ${isCompanyWide ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
      <SummaryCard label="Active" value={active} />
      {proofAwaitingCount !== null && (
        <SummaryCard label="Awaiting Proof" value={proofAwaitingCount} />
      )}
      <SummaryCard label="Completed" value={completed} />
      <SummaryCard label="Total" value={total} />
    </div>
  )
}

function SummaryCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="rounded-3xl bg-white p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 font-dm-sans text-3xl font-medium text-gray-900 tabular-nums">{value}</p>
    </div>
  )
}
