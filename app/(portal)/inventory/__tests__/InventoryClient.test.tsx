import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InventoryClient } from '../InventoryClient'
import type { CustomerInventoryRow } from '@/lib/inventory/customer-rows'

// InventoryClient is presentational: the page server-renders the data and passes
// it as props. Sprint 4 collapsed the stock table to Product/Colour/Size/Available,
// surfaced the design name, and removed the Committed/Audit/stock-movement internals.
const rows: CustomerInventoryRow[] = [
  {
    variant_id: 'v1',
    size_id: 1,
    product_id: 'p1',
    product_name: 'Classic Tee',
    design_name: 'AF Logo Tee',
    colour_name: 'Black',
    colour_hex: '#000000',
    size_label: 'L',
    available_qty: 24,
    stock_qty: 30,
    committed_qty: 6,
    updated_at: '2026-06-01T00:00:00Z',
  },
  {
    variant_id: 'v2',
    size_id: 2,
    product_id: 'p2',
    product_name: 'Premium Hoodie',
    design_name: null,
    colour_name: 'Navy',
    colour_hex: '#001155',
    size_label: 'M',
    available_qty: 12,
    stock_qty: 12,
    committed_qty: 0,
    updated_at: '2026-06-02T00:00:00Z',
  },
]

describe('InventoryClient', () => {
  it('shows the design name as the primary product title with the blank garment as a subtitle', () => {
    render(<InventoryClient rows={rows} />)
    expect(screen.getByText('AF Logo Tee')).toBeInTheDocument()
    expect(screen.getByText('Classic Tee')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
  })

  it('falls back to the blank garment name when the blank has no single design', () => {
    render(<InventoryClient rows={rows} />)
    // Row v2 has design_name = null, so the garment name is the primary title.
    expect(screen.getByText('Premium Hoodie')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('hides the internal Committed / Audit / stock-movement columns and jargon', () => {
    render(<InventoryClient rows={rows} />)
    expect(screen.queryByText('Committed')).not.toBeInTheDocument()
    expect(screen.queryByText('In stock')).not.toBeInTheDocument()
    expect(screen.queryByText('Audit')).not.toBeInTheDocument()
    expect(screen.queryByText('View')).not.toBeInTheDocument()
    expect(screen.queryByText(/stock movements/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/order_commit_partial/)).not.toBeInTheDocument()
  })

  it('renders an explanatory byline under the heading', () => {
    render(<InventoryClient rows={rows} />)
    expect(screen.getByText(/how many\s+you can order right now/i)).toBeInTheDocument()
  })
})
