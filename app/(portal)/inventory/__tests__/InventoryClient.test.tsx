import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InventoryClient } from '../InventoryClient'
import type { CustomerInventoryRow } from '@/lib/inventory/customer-rows'
import type { AuditEntry } from '@/lib/inventory/audit'

// InventoryClient is now presentational: the page server-renders the data and
// passes it as props (no client fetch), so the test renders with props directly.
const rows: CustomerInventoryRow[] = [
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
]

const entries: AuditEntry[] = [
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
  } as AuditEntry,
]

describe('InventoryClient', () => {
  it('renders the stock table and the audit feed from server-provided props', () => {
    render(<InventoryClient rows={rows} entries={entries} />)
    expect(screen.getByText('Basic Tee')).toBeInTheDocument()
    expect(screen.getByText('Jane Buyer')).toBeInTheDocument()
    expect(screen.getByText('Queen St Store')).toBeInTheDocument()
  })
})
