import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the monday API client BEFORE importing the module under test.
vi.mock('../client', () => ({
  mondayApiCall: vi.fn(),
}))

import { mondayApiCall } from '../client'
import { pushOrderDeal, type OrderDealData } from '../deal-item'
import { PRODUCTION_BOARD_ID, PRODUCTION_COLUMNS } from '../column-ids'

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
  // Order path targets the Production board now; exercise the default (no override).
  delete process.env.MONDAY_PRODUCTION_BOARD_ID
  delete process.env.MONDAY_PRODUCTION_DEMO_GROUP_ID
})

describe('pushOrderDeal — Production board target', () => {
  it('creates the order item on the Production board, Pre-production group', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-99', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal(fixture)

    const [, itemVars] = mockedCall.mock.calls[0]
    const vars = itemVars as { boardId: string; groupId: string }
    expect(vars.boardId).toBe(String(PRODUCTION_BOARD_ID))
    expect(vars.groupId).toBe('topics')
  })

  it('honours MONDAY_PRODUCTION_BOARD_ID override when set', async () => {
    process.env.MONDAY_PRODUCTION_BOARD_ID = '9999999'
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal(fixture)

    const [, itemVars] = mockedCall.mock.calls[0]
    expect((itemVars as { boardId: string }).boardId).toBe('9999999')
  })
})

describe('pushOrderDeal — Production column mapping', () => {
  it('maps order fields onto Production columns and drops CRM-only columns', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-99', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal(fixture)

    // 1 create_item + 3 create_subitem = 4 calls total
    expect(mockedCall).toHaveBeenCalledTimes(4)

    const [, itemVars] = mockedCall.mock.calls[0]
    const cv = JSON.parse((itemVars as { columnValues: string }).columnValues)

    // Production columns populated.
    expect(cv[PRODUCTION_COLUMNS.customerEmail]).toEqual({
      email: 'buyer@acme.test',
      text: 'buyer@acme.test',
    })
    expect(cv[PRODUCTION_COLUMNS.poRef]).toBe('ORD-2026-0042')
    expect(cv[PRODUCTION_COLUMNS.quoteTotal]).toBe(1234.5)
    expect(cv[PRODUCTION_COLUMNS.inHandDate]).toEqual({ date: '2026-06-15' })
    expect(cv[PRODUCTION_COLUMNS.mainStatus]).toEqual({
      label: 'Need: Mockup (Quote Approved)',
    })
    // Intent tag separates fresh orders from reorders in the shared group.
    expect(cv[PRODUCTION_COLUMNS.intent]).toEqual({ label: 'Order' })

    const jobSpecs = cv[PRODUCTION_COLUMNS.jobSpecs].text as string
    expect(jobSpecs).toContain('ORD-2026-0042')
    expect(jobSpecs).toContain('• Logo Front: Basic Tee — Black / M × 10')
    expect(jobSpecs).toContain('• Crew Back: Heavy Hood — Navy / L × 5')
    expect(jobSpecs).toContain('• No decoration: Cap — OS × 20')

    // CRM Deals-only columns must NOT be sent to a Production item — they don't
    // exist on that board and would trigger a ColumnValueException.
    expect(cv.color_mkzhwkjn).toBeUndefined() // deal_source
    expect(cv.deal_stage).toBeUndefined()
    expect(cv.long_text_mkzjhs9j).toBeUndefined() // Deals full-form-response
    expect(cv.text_mkzjv77f).toBeUndefined() // Deals customer name
    expect(cv.text_mkzj78dx).toBeUndefined() // Deals product summary
  })

  it('omits the in-hand date column when the order has no required-by date', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal({ ...fixture, inHandDate: null })

    const [, itemVars] = mockedCall.mock.calls[0]
    const cv = JSON.parse((itemVars as { columnValues: string }).columnValues)
    expect(cv[PRODUCTION_COLUMNS.inHandDate]).toBeUndefined()
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
