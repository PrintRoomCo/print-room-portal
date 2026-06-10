import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the monday API client BEFORE importing the module under test.
vi.mock('../client', () => ({
  mondayApiCall: vi.fn(),
}))

import { mondayApiCall } from '../client'
import { pushOrderDeal, type OrderDealData } from '../deal-item'

const mockedCall = vi.mocked(mondayApiCall)

const fixture: OrderDealData = {
  customerEmail: 'demo@printroom.test',
  customerName: 'Demo Buyer',
  customerCompany: 'Demo Org',
  orderRef: 'ORD-2026-0099',
  inHandDate: null,
  notes: null,
  totalAmount: 100,
  lines: [
    {
      quoteItemId: 'qi-1',
      productName: 'Basic Tee',
      variantLabel: 'Black / M',
      designName: 'No decoration',
      quantity: 5,
    },
  ],
}

function groupIdOfFirstCall(): string {
  return (mockedCall.mock.calls[0][1] as { groupId: string }).groupId
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MONDAY_REORDERS_BOARD_ID = '2046357917'
  delete process.env.MONDAY_DEMO_GROUP_ID
  mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
  mockedCall.mockResolvedValue({ create_subitem: { id: 'sub-1' } })
})

describe('pushOrderDeal — demo group routing', () => {
  it('defaults to the production New Deals group', async () => {
    await pushOrderDeal(fixture)
    expect(groupIdOfFirstCall()).toBe('topics')
  })

  it('routes to MONDAY_DEMO_GROUP_ID when demo: true', async () => {
    process.env.MONDAY_DEMO_GROUP_ID = 'demo_group_123'
    await pushOrderDeal(fixture, { demo: true })
    expect(groupIdOfFirstCall()).toBe('demo_group_123')
  })

  it('demo: false routes to production even when the env var is set', async () => {
    process.env.MONDAY_DEMO_GROUP_ID = 'demo_group_123'
    await pushOrderDeal(fixture, { demo: false })
    expect(groupIdOfFirstCall()).toBe('topics')
  })

  it('falls back to production group (with a warning) when env var is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await pushOrderDeal(fixture, { demo: true })
    expect(groupIdOfFirstCall()).toBe('topics')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
