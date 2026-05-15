import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CollectionDetail from '../[collectionId]/page'

vi.mock('next/navigation', () => ({
  useParams: () => ({ collectionId: 'collection-1' }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({
    access: { companyId: 'company-1', userId: 'user-1' },
    loading: false,
  }),
}))

vi.mock('../[collectionId]/actions', () => ({
  updateCollectionAction: vi.fn().mockResolvedValue({}),
  deleteCollectionAction: vi.fn().mockResolvedValue({}),
  submitCollectionAction: vi.fn().mockResolvedValue({}),
  reviseCollectionAction: vi.fn().mockResolvedValue({}),
  addDesignAction: vi.fn().mockResolvedValue({}),
  removeDesignAction: vi.fn().mockResolvedValue({}),
}))

const design = {
  id: 'design-1',
  customer_id: 'customer-1',
  customer_email: 'buyer@example.com',
  company_id: 'company-1',
  design_id: 'source-design-1',
  design_name: 'Mountain hoodie',
  design_data: {},
  pricing_data: null,
  images: null,
  status: 'pending_review',
  shopify_product_id: null,
  submitted_at: null,
  reviewed_at: null,
  reviewed_by: null,
  notes: null,
  created_at: '2026-05-15T00:00:00.000Z',
  updated_at: '2026-05-15T00:00:00.000Z',
  catalog_id: null,
  collection_id: 'collection-1',
  monday_subitem_id: null,
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        mode: 'collection',
        collection: {
          id: 'collection-1',
          name: 'Summer collection',
          description: 'Draft range',
          quote_id: null,
          customer_id: 'customer-1',
          customer_email: 'buyer@example.com',
          company_id: 'company-1',
          catalog_id: null,
          status: 'draft',
          monday_item_id: null,
          shopify_collection_id: null,
          created_at: '2026-05-15T00:00:00.000Z',
          updated_at: '2026-05-15T00:00:00.000Z',
          submitted_at: null,
          approved_at: null,
          notes: null,
          platform: 'test',
          designs: [design],
          design_count: 1,
        },
        availableDesigns: [{ ...design, id: 'design-2', design_name: 'Classic tee' }],
        tracker: null,
      }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('collection detail modals', () => {
  it('closes each dialog on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<CollectionDetail />)

    await screen.findByRole('heading', { name: /summer collection/i })

    const cases: Array<[RegExp, RegExp]> = [
      [/edit/i, /edit collection/i],
      [/delete/i, /delete "summer collection"/i],
      [/submit for approval/i, /submit for approval/i],
      [/add existing/i, /add design/i],
    ]

    for (const [buttonName, dialogName] of cases) {
      const trigger = screen.getByRole('button', { name: buttonName })
      await user.click(trigger)

      expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()

      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
      })
      expect(trigger).toHaveFocus()
    }
  })
})
