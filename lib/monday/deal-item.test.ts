import { describe, it, expect } from 'vitest'
import { buildOrderFullFormResponse, type OrderDealData } from './deal-item'

const base: OrderDealData = {
  customerEmail: 'buyer@example.com',
  customerName: 'White Fox',
  customerCompany: 'White Fox',
  orderRef: 'WFOX-000001',
  inHandDate: null,
  deliveryAddress: null,
  notes: null,
  totalAmount: 1234,
  lines: [],
}

describe('buildOrderFullFormResponse currency suffix (AU Stage 1)', () => {
  it('NZD / absent currency → unchanged Total line', () => {
    expect(buildOrderFullFormResponse(base)).toContain('Total: $1234.00\n')
    expect(buildOrderFullFormResponse({ ...base, currency: 'NZD' })).toContain('Total: $1234.00\n')
  })
  it('AUD → Total: $X (AUD)', () => {
    expect(buildOrderFullFormResponse({ ...base, currency: 'AUD' })).toContain('Total: $1234.00 (AUD)')
  })
})
