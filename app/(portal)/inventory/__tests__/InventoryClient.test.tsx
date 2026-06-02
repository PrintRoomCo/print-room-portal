import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { InventoryClient } from '../InventoryClient'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/inventory') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rows: [
              {
                variant_id: 'v1',
                product_id: 'p1',
                product_name: 'Basic Tee',
                colour_name: 'Bone',
                colour_hex: '#eee',
                size_label: 'M',
                available_qty: 12,
                stock_qty: 20,
                committed_qty: 8,
                updated_at: '2026-06-01T00:00:00Z',
              },
            ],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          entries: [
            {
              id: 'e1',
              variantId: 'v1',
              reason: 'order_commit',
              deltaStock: -5,
              deltaCommitted: 0,
              note: null,
              who: 'Jane Buyer',
              where: 'Queen St Store',
              source: 'order',
              createdAt: '2026-06-01T00:00:00Z',
            },
          ],
        }),
      })
    }),
  )
})

describe('InventoryClient', () => {
  it('renders the stock table and the audit feed from the two endpoints', async () => {
    render(<InventoryClient />)
    await waitFor(() => expect(screen.getByText('Basic Tee')).toBeInTheDocument())
    expect(screen.getByText('Jane Buyer')).toBeInTheDocument()
    expect(screen.getByText('Queen St Store')).toBeInTheDocument()
  })
})
