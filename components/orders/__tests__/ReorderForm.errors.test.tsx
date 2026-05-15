import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobTracker } from '@/lib/job-tracker'
import { ReorderForm } from '../ReorderForm'

const tracker: JobTracker = {
  id: 'tracker-1',
  tracker_token: 'token-1',
  job_reference: 'JOB-123',
  monday_item_id: null,
  quote_id: null,
  monday_project_name: null,
  quote_number: null,
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  user_id: null,
  company_id: null,
  location_id: null,
  status: 'dispatched',
  tracking_info: null,
  status_history: [],
  production_updates: [],
  estimated_delivery_at: null,
  design_approval_at: null,
  production_start_at: null,
  production_complete_at: null,
  product_images: [],
  proof_files: null,
  quote_data: null,
  quote_data_source: 'unknown',
  monday_board_id: null,
  monday_items_synced_at: null,
  created_at: '2026-05-15T00:00:00.000Z',
  last_synced_at: null,
  platform: 'test',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReorderForm errors', () => {
  it('renders submission errors inside an alert region', async () => {
    const onSubmitted = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Reorder API failed' }),
      }),
    )

    render(
      <ReorderForm
        tracker={tracker}
        userEmail="buyer@example.com"
        onSubmitted={onSubmitted}
        onCancel={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText(/delivery address/i), {
      target: { value: '123 Test Street, Sydney NSW 2000' },
    })
    fireEvent.change(screen.getByLabelText(/in-hand date/i), {
      target: { value: '2099-01-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit reorder/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Reorder API failed')
    await waitFor(() => expect(onSubmitted).not.toHaveBeenCalled())
  })
})
