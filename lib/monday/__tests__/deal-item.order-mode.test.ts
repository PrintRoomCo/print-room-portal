import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the monday API client BEFORE importing the module under test.
vi.mock('../client', () => ({
  mondayApiCall: vi.fn(),
}))

import { mondayApiCall } from '../client'
import { pushOrderDeal, type OrderDealData } from '../deal-item'

const mockedCall = vi.mocked(mondayApiCall)

const fixture: OrderDealData = {
  customerEmail: 'buyer@acme.test',
  customerName: 'Sam Buyer',
  customerCompany: 'Acme Co',
  orderRef: 'ORD-2026-0042',
  inHandDate: '2026-06-15',
  notes: '  Wrap in tissue please  ',
  totalAmount: 1234.5,
  lines: [
    {
      quoteItemId: 'qi-1',
      productName: 'Basic Tee',
      variantLabel: 'Black / M',
      designName: 'Logo Front',
      quantity: 10,
    },
    {
      quoteItemId: 'qi-2',
      productName: 'Heavy Hood',
      variantLabel: 'Navy / L',
      designName: 'Crew Back',
      quantity: 5,
    },
    {
      quoteItemId: 'qi-3',
      productName: 'Cap',
      variantLabel: 'OS',
      designName: 'No decoration',
      quantity: 20,
    },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MONDAY_REORDERS_BOARD_ID = '2046357917'
})

describe('pushOrderDeal — happy path', () => {
  it('creates one item with order-mode column values and order ref in long text', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-99', name: 'x' } })
    // 3 subitem responses
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    const result = await pushOrderDeal(fixture)

    expect(result.itemId).toBe('item-99')
    // 1 create_item + 3 create_subitem = 4 calls total
    expect(mockedCall).toHaveBeenCalledTimes(4)

    const [, itemVars] = mockedCall.mock.calls[0]
    const cv = JSON.parse((itemVars as { columnValues: string }).columnValues)
    expect(cv.color_mkzhwkjn).toEqual({ label: 'Portal - Order' })
    expect(cv.deal_stage).toEqual({ label: 'New' })
    const longText = cv.long_text_mkzjhs9j.text as string
    expect(longText).toContain('ORD-2026-0042')
    expect(longText).toContain('• Logo Front: Basic Tee — Black / M × 10')
    expect(longText).toContain('• Crew Back: Heavy Hood — Navy / L × 5')
    expect(longText).toContain('• No decoration: Cap — OS × 20')
  })
})

describe('pushOrderDeal — subitem per line', () => {
  it('calls create_subitem once per line with design-prefixed names', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal(fixture)

    const subitemCalls = mockedCall.mock.calls.slice(1)
    expect(subitemCalls).toHaveLength(3)
    const names = subitemCalls.map((c) => (c[1] as { itemName: string }).itemName)
    expect(names[0]).toBe('Logo Front: Basic Tee — Black / M × 10')
    expect(names[1]).toBe('Crew Back: Heavy Hood — Navy / L × 5')
    expect(names[2]).toBe('No decoration: Cap — OS × 20')
  })
})

describe('pushOrderDeal — subitem failure is non-fatal', () => {
  it('resolves with partial subitemIds when one subitem throws', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-7', name: 'x' } })
    mockedCall.mockResolvedValueOnce({ create_subitem: { id: 'sub-1' } })
    mockedCall.mockRejectedValueOnce(new Error('boom'))
    mockedCall.mockResolvedValueOnce({ create_subitem: { id: 'sub-3' } })

    const result = await pushOrderDeal(fixture)

    expect(result.itemId).toBe('item-7')
    expect(result.subitemIds).toEqual({ 'qi-1': 'sub-1', 'qi-3': 'sub-3' })
    expect(result.subitemIds['qi-2']).toBeUndefined()
  })
})
