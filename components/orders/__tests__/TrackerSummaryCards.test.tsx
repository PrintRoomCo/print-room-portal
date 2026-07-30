import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrackerSummaryCards } from '../TrackerSummaryCards'
import type { JobTracker } from '@/lib/job-tracker'

// The summary cards only read `.status` and `.length`, so keep fixtures minimal.
function tracker(status: string | null): JobTracker {
  return { id: `t-${status ?? 'null'}`, status } as unknown as JobTracker
}

/** Value shown on the card whose label is `label`. */
function cardValue(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.querySelector('p:last-child')?.textContent
}

describe('TrackerSummaryCards', () => {
  it('handles a null-status tracker in the company-wide view without throwing', () => {
    // Regression: a Monday-synced tracker with no status yet (job_trackers.status
    // is SQL NULL) crashed the org-admin "Past orders" page — the company-wide
    // "Awaiting Proof" counter dereferenced t.status.toLowerCase() with no null
    // guard, unlike every sibling (isTrackerCompleted guards null). Anytime
    // Fitness had two such trackers (ids 1399, 1416) pulled in by the member
    // user_id arm of getJobsForOrganization.
    const trackers = [tracker(null), tracker('proof-sent'), tracker('dispatched')]

    render(<TrackerSummaryCards trackers={trackers} isCompanyWide />)

    // null + proof-sent are Active (2); dispatched is Completed (1); Total 3.
    expect(cardValue('Total')).toBe('3')
    expect(cardValue('Active')).toBe('2')
    expect(cardValue('Completed')).toBe('1')
    // The null-status tracker must be skipped, not counted or crashed.
    expect(cardValue('Awaiting Proof')).toBe('1')
  })
})
