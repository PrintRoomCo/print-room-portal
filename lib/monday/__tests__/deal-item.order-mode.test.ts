import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the monday API client BEFORE importing the module under test.
vi.mock('../client', () => ({
  mondayApiCall: vi.fn(),
}))

import { mondayApiCall } from '../client'
import { pushOrderDeal, type OrderDealData } from '../deal-item'
import {
  PRODUCTION_BOARD_ID,
  PRODUCTION_COLUMNS,
  PRODUCTION_SUBITEM_COLUMNS,
} from '../column-ids'

const mockedCall = vi.mocked(mondayApiCall)

const fixture: OrderDealData = {
  customerEmail: 'buyer@acme.test',
  customerName: 'Sam Buyer',
  customerCompany: 'Acme Co',
  orderRef: 'ORD-2026-0042',
  inHandDate: '2026-06-15',
  deliveryAddress: 'Sam Buyer\n12 Queen St\nAuckland 1010\nNZ',
  notes: '  Wrap in tissue please  ',
  totalAmount: 1234.5,
  lines: [
    {
      quoteItemId: 'qi-1',
      productName: 'Basic Tee',
      variantLabel: 'Black / M',
      colorName: 'Black',
      sizeLabel: 'M',
      designName: 'Logo Front',
      quantity: 10,
    },
    {
      quoteItemId: 'qi-2',
      productName: 'Heavy Hood',
      variantLabel: 'Navy / L',
      colorName: 'Navy',
      sizeLabel: 'L',
      designName: 'Crew Back',
      quantity: 5,
    },
    {
      quoteItemId: 'qi-3',
      productName: 'Cap',
      variantLabel: 'OS',
      colorName: null,
      sizeLabel: 'OS',
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
    expect(jobSpecs).toContain('--- Delivery Address ---')
    expect(jobSpecs).toContain('12 Queen St')
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
  it('calls create_subitem once per line with compact design-prefixed names', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal(fixture)

    const subitemCalls = mockedCall.mock.calls.slice(1)
    expect(subitemCalls).toHaveLength(3)
    const names = subitemCalls.map((c) => (c[1] as { itemName: string }).itemName)
    expect(names[0]).toBe('Logo Front: Basic Tee')
    expect(names[1]).toBe('Crew Back: Heavy Hood')
    expect(names[2]).toBe('No decoration: Cap')
  })

  it('maps product colour, size, and quantity to Production subitem columns', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal(fixture)

    const firstSubitemVars = mockedCall.mock.calls[1][1] as {
      columnValues: string
    }
    const firstCv = JSON.parse(firstSubitemVars.columnValues)
    expect(firstCv[PRODUCTION_SUBITEM_COLUMNS.fallbackGarment]).toBe('Basic Tee')
    expect(firstCv[PRODUCTION_SUBITEM_COLUMNS.fallbackColor]).toBe('Black')
    expect(firstCv[PRODUCTION_SUBITEM_COLUMNS.sizes.M]).toBe(10)

    const oneSizeSubitemVars = mockedCall.mock.calls[3][1] as {
      columnValues: string
    }
    const oneSizeCv = JSON.parse(oneSizeSubitemVars.columnValues)
    expect(oneSizeCv[PRODUCTION_SUBITEM_COLUMNS.fallbackGarment]).toBe('Cap')
    expect(oneSizeCv[PRODUCTION_SUBITEM_COLUMNS.fallbackColor]).toBeUndefined()
    expect(oneSizeCv[PRODUCTION_SUBITEM_COLUMNS.sizes.ONE]).toBe(20)
  })
})

describe('pushOrderDeal — size label normalization', () => {
  const CASES: Array<{
    sizeLabel: string
    sizeKey: keyof typeof PRODUCTION_SUBITEM_COLUMNS.sizes
  }> = [
    // Numeric AU/women's sizing → board's dual-labelled letter columns.
    { sizeLabel: '6', sizeKey: 'XXS' },
    { sizeLabel: '8', sizeKey: 'XS' },
    { sizeLabel: '10', sizeKey: 'S' },
    { sizeLabel: '12', sizeKey: 'M' },
    { sizeLabel: '14', sizeKey: 'L' },
    { sizeLabel: '16', sizeKey: 'XL' },
    { sizeLabel: '18', sizeKey: '2XL' },
    { sizeLabel: '20', sizeKey: '3XL' },
    { sizeLabel: '22', sizeKey: '4XL' },
    { sizeLabel: '24', sizeKey: '5XL' },
    // Letter aliases and suffixed kids ranges.
    { sizeLabel: '2XS', sizeKey: 'XXS' },
    { sizeLabel: 'XXL', sizeKey: '2XL' },
    { sizeLabel: '4-8 US', sizeKey: '4-8' },
    { sizeLabel: '9-13 US', sizeKey: '9-13' },
  ]

  it('routes numeric, alias, and suffixed sizes onto the correct size columns', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })

    await pushOrderDeal({
      ...fixture,
      lines: CASES.map((c, i) => ({
        quoteItemId: `qi-${i}`,
        productName: 'Tee',
        variantLabel: c.sizeLabel,
        colorName: null,
        sizeLabel: c.sizeLabel,
        designName: 'D',
        quantity: i + 1,
      })),
    })

    const subitemCalls = mockedCall.mock.calls.slice(1)
    expect(subitemCalls).toHaveLength(CASES.length)
    subitemCalls.forEach((call, i) => {
      const cv = JSON.parse((call[1] as { columnValues: string }).columnValues)
      const expectedColumn = PRODUCTION_SUBITEM_COLUMNS.sizes[CASES[i].sizeKey]
      // Only the matched size column carries the quantity; nothing leaks to ONE.
      expect(cv[expectedColumn]).toBe(i + 1)
      if (CASES[i].sizeKey !== 'ONE') {
        expect(cv[PRODUCTION_SUBITEM_COLUMNS.sizes.ONE]).toBeUndefined()
      }
    })
  })

  it('falls back to One Size and warns for a size with no board column', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })
    mockedCall.mockResolvedValue({ create_subitem: { id: 'sub' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await pushOrderDeal({
      ...fixture,
      lines: [
        {
          quoteItemId: 'qi-1',
          productName: 'Hi-Vis',
          variantLabel: '7XL',
          colorName: null,
          sizeLabel: '7XL',
          designName: 'D',
          quantity: 3,
        },
      ],
    })

    const cv = JSON.parse(
      (mockedCall.mock.calls[1][1] as { columnValues: string }).columnValues,
    )
    expect(cv[PRODUCTION_SUBITEM_COLUMNS.sizes.ONE]).toBe(3)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('7XL'))
    warn.mockRestore()
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
