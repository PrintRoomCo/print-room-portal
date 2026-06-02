'use client'

import Link from 'next/link'
import { JobTrackerOrderCard } from '@/components/orders/JobTrackerOrderCard'
import type { JobTracker } from '@/lib/job-tracker'

interface SingleTrackerClientProps {
  tracker: JobTracker
}

export function SingleTrackerClient({ tracker }: SingleTrackerClientProps) {
  const heading =
    tracker.quote_number ||
    tracker.monday_project_name ||
    tracker.job_reference ||
    `Order ${tracker.tracker_token.slice(0, 8).toUpperCase()}`

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] motion-safe:animate-portal-enter md:px-6 md:pt-[120px]">
        <header className="mb-8 md:mb-10">
          <Link
            href="/order-tracker"
            className="inline-flex rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
            aria-label="Back to order tracking"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="mt-4 font-dm-sans text-[clamp(32px,4vw,56px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            {heading}
          </h1>
          <p className="mt-3 max-w-prose text-base text-gray-600">
            Live status for your order.
          </p>
        </header>

        <JobTrackerOrderCard tracker={tracker} defaultExpanded hideTrackerLink />
      </div>
    </div>
  )
}
