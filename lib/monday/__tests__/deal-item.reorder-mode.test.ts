import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the monday API client BEFORE importing the module under test.
vi.mock('../client', () => ({
  mondayApiCall: vi.fn(),
}))

import { mondayApiCall } from '../client'
import { createReorderItem, type ReorderData } from '../deal-item'
import { PRODUCTION_BOARD_ID, PRODUCTION_COLUMNS } from '../column-ids'

const mockedCall = vi.mocked(mondayApiCall)

const fixture: ReorderData = {
  customerEmail: 'repeat@acme.test',
  customerName: 'Rita Repeat',
  customerPhone: '021 555 0000',
  customerCompany: 'Acme Co',
  originalQuoteNumber: 'Q-1001',
  originalJobReference: 'JOB-77',
  mondayProjectName: 'Acme Summer Tees',
  deliveryAddress: '12 Queen St, Auckland',
  inHandDate: '2026-08-01',
  notes: 'Same as last time please',
  artworkUrls: [],
  proofFileUrls: [],
  // quantity intentionally omitted — exercises the sizes-sum total path.
  originalItems: [
    {
      productName: 'Classic Tee',
      designInstanceId: 'd1',
      sizes: { S: 10, M: 20, L: 20 }, // = 50
    },
  ],
  designNamesByInstanceId: { d1: 'Front Logo' },
}

function itemVarsOfFirstCall(): {
  boardId: string
  groupId: string
  itemName: string
  columnValues: string
} {
  return mockedCall.mock.calls[0][1] as {
    boardId: string
    groupId: string
    itemName: string
    columnValues: string
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  // Reorders target the Production board now; exercise the default (no override).
  delete process.env.MONDAY_PRODUCTION_BOARD_ID
})

describe('createReorderItem — Production board target', () => {
  it('creates the reorder item on the Production board, Pre-production group', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-99', name: 'x' } })

    await createReorderItem(fixture)

    const vars = itemVarsOfFirstCall()
    expect(vars.boardId).toBe(String(PRODUCTION_BOARD_ID))
    expect(vars.groupId).toBe('topics')
  })

  it('honours MONDAY_PRODUCTION_BOARD_ID override when set', async () => {
    process.env.MONDAY_PRODUCTION_BOARD_ID = '9999999'
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })

    await createReorderItem(fixture)

    expect(itemVarsOfFirstCall().boardId).toBe('9999999')
  })

  it('names the item with a "- Reorder" suffix so it reads apart from orders', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })

    await createReorderItem(fixture)

    expect(itemVarsOfFirstCall().itemName).toBe('Rita Repeat - Acme Co - Reorder')
  })
})

describe('createReorderItem — Production column mapping', () => {
  it('maps reorder fields onto Production columns, tags Intent=Reorder, drops CRM-only columns', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-99', name: 'x' } })

    await createReorderItem(fixture)

    const cv = JSON.parse(itemVarsOfFirstCall().columnValues)

    expect(cv[PRODUCTION_COLUMNS.customerEmail]).toEqual({
      email: 'repeat@acme.test',
      text: 'repeat@acme.test',
    })
    // poRef column is titled "Job Reference" on the board — prefer the quote no.
    expect(cv[PRODUCTION_COLUMNS.poRef]).toBe('Q-1001')
    expect(cv[PRODUCTION_COLUMNS.inHandDate]).toEqual({ date: '2026-08-01' })
    expect(cv[PRODUCTION_COLUMNS.qty]).toBe('50')
    expect(cv[PRODUCTION_COLUMNS.intent]).toEqual({ label: 'Reorder' })

    // Full breakdown survives in the Job Specs long-text.
    const jobSpecs = cv[PRODUCTION_COLUMNS.jobSpecs].text as string
    expect(jobSpecs).toContain('Q-1001')
    expect(jobSpecs).toContain('Classic Tee')
    expect(jobSpecs).toContain('Front Logo')

    // Reorders don't invent a Job Status — staff triage in Pre-production.
    expect(cv[PRODUCTION_COLUMNS.mainStatus]).toBeUndefined()

    // CRM Deals-only columns must NOT be sent to a Production item.
    expect(cv.color_mkzhwkjn).toBeUndefined() // deal_source
    expect(cv.deal_stage).toBeUndefined()
    expect(cv.long_text_mkzjhs9j).toBeUndefined() // Deals full-form-response
    expect(cv.text_mkzjv77f).toBeUndefined() // Deals customer name
    expect(cv.text_mkzj78dx).toBeUndefined() // Deals product summary
    expect(cv.email_mkzjab7s).toBeUndefined() // Deals email
    expect(cv.text_mkzjj9j5).toBeUndefined() // Deals qty
  })

  it('falls back to the job reference for poRef when there is no quote number', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })

    await createReorderItem({ ...fixture, originalQuoteNumber: null })

    const cv = JSON.parse(itemVarsOfFirstCall().columnValues)
    expect(cv[PRODUCTION_COLUMNS.poRef]).toBe('JOB-77')
  })
})

describe('createReorderItem — no sub-items', () => {
  it('creates a single item and never calls create_subitem', async () => {
    mockedCall.mockResolvedValueOnce({ create_item: { id: 'item-1', name: 'x' } })

    await createReorderItem(fixture)

    expect(mockedCall).toHaveBeenCalledTimes(1)
    const mutation = mockedCall.mock.calls[0][0] as string
    expect(mutation).not.toContain('create_subitem')
  })
})
