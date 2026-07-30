import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { JobTrackerOrderCard } from '../JobTrackerOrderCard'
import type { JobTracker } from '@/lib/job-tracker'

function tracker(overrides: Partial<JobTracker> = {}): JobTracker {
  return {
    id: 'tracker-1',
    tracker_token: 'token-1',
    job_reference: null,
    monday_item_id: null,
    quote_id: null,
    monday_project_name: null,
    quote_number: 'Q-100',
    customer_email: 'sam@example.test',
    customer_name: 'Sam Buyer',
    user_id: 'user-1',
    company_id: 'org-1',
    location_id: null,
    status: 'in-production',
    tracking_info: null,
    status_history: [],
    production_updates: [],
    estimated_delivery_at: null,
    design_approval_at: null,
    production_start_at: null,
    production_complete_at: null,
    product_images: [],
    proof_files: null,
    quote_data: {
      items: [],
      summary: { total: 115 },
      currencyCode: 'NZD',
      shippingAddress: {
        name: 'Sam Buyer',
        street: '12 Queen St',
        city: 'Auckland',
        postalCode: '1010',
        country: 'NZ',
      },
    },
    quote_data_source: 'submit-quote',
    monday_board_id: null,
    monday_items_synced_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    last_synced_at: null,
    platform: 'portal',
    ...overrides,
  }
}

describe('JobTrackerOrderCard', () => {
  it('renders the carried delivery address when expanded', () => {
    render(<JobTrackerOrderCard tracker={tracker()} defaultExpanded />)

    expect(screen.getByRole('heading', { name: /delivery address/i })).toBeInTheDocument()
    expect(screen.getByText('Sam Buyer')).toBeInTheDocument()
    expect(screen.getByText('12 Queen St')).toBeInTheDocument()
    expect(screen.getByText('Auckland 1010')).toBeInTheDocument()
    expect(screen.getByText('NZ')).toBeInTheDocument()
  })

  it('shows a fulfilment badge instead of the production bar for a stock order', () => {
    render(
      <JobTrackerOrderCard
        tracker={tracker({ order_type: 'stock_on_hand', status: 'need-proof' })}
        defaultExpanded
      />,
    )
    // Stock order → simple Unfulfilled badge, and the production step label for
    // this status ("Proof Prep") must not appear.
    expect(screen.getByText('Unfulfilled')).toBeInTheDocument()
    expect(screen.queryByText('Proof Prep')).toBeNull()
  })
})
