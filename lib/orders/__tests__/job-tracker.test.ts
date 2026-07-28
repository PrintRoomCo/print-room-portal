import { describe, it, expect, vi } from 'vitest'
import { createJobTrackerShellForOrder } from '../job-tracker'

type AnyRow = Record<string, unknown>

interface SelectMatcher {
  table: string
  response: { data: AnyRow | AnyRow[] | null; error: { message: string } | null }
}

interface InsertResponse {
  table: string
  data: AnyRow | null
  error: { message: string } | null
}

interface WriteRecord {
  table: string
  op: 'insert' | 'update'
  payload: AnyRow | AnyRow[]
  filters: Array<{ column: string; value: unknown }>
}

function makeStub(opts: {
  selects: SelectMatcher[]
  insertResponses?: InsertResponse[]
  updateResponses?: InsertResponse[]
}) {
  const writes: WriteRecord[] = []

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const matchSelect = () =>
      opts.selects.find((m) => m.table === table)?.response ?? { data: [], error: null }

    const matchInsert = () =>
      opts.insertResponses?.find((m) => m.table === table) ?? {
        table,
        data: null,
        error: null,
      }
    const matchUpdate = () =>
      opts.updateResponses?.find((m) => m.table === table) ?? {
        table,
        data: null,
        error: null,
      }

    const settle = () => {
      if (pendingWrite) {
        writes.push({ table, op: pendingWrite.op, payload: pendingWrite.payload, filters: [...filters] })
        const m = pendingWrite.op === 'insert' ? matchInsert() : matchUpdate()
        return { data: m.data, error: m.error }
      }
      return matchSelect()
    }

    const builder = {
      select: () => builder,
      insert: (payload: AnyRow | AnyRow[]) => {
        pendingWrite = { op: 'insert', payload }
        return builder
      },
      update: (payload: AnyRow) => {
        pendingWrite = { op: 'update', payload }
        return builder
      },
      eq: (column: string, value: unknown) => {
        filters.push({ column, value })
        return builder
      },
      in: (column: string, value: unknown) => {
        filters.push({ column, value })
        return builder
      },
      is: (column: string, value: unknown) => {
        filters.push({ column, value })
        return builder
      },
      single: async () => settle(),
      maybeSingle: async () => {
        const r = settle()
        if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error }
        return r
      },
      then<R1, R2>(
        resolve: (v: unknown) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        return Promise.resolve(settle()).then(resolve, reject)
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
  } as unknown as Parameters<typeof createJobTrackerShellForOrder>[0]

  return { admin, writes }
}

const QUOTE_ID = '00000000-0000-0000-0000-000000000222'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'

function baseSelects(): SelectMatcher[] {
  return [
    {
      table: 'b2b_accounts',
      response: { data: { company_id: 'COMP-XYZ' }, error: null },
    },
    {
      table: 'quotes',
      response: {
        data: { subtotal: 100, decoration_cost: 10, total_amount: 115 },
        error: null,
      },
    },
    {
      table: 'quote_items',
      response: {
        data: [
          {
            id: 'qi-1',
            product_id: 'prod-1',
            product_name: 'Basic Tee',
            quantity: 10,
            unit_price: 10,
            decorations: [
              { name: 'Front logo', artworkUrl: 'https://x/front.png', method: 'screen' },
            ],
            size_label: 'M',
            product_variants: {
              product_color_swatches: { label: 'Navy', hex: '#0b1c2c' },
            },
          },
        ],
        error: null,
      },
    },
    { table: 'job_trackers', response: { data: null, error: null } }, // no existing
    {
      table: 'products',
      response: { data: [{ id: 'prod-1', image_url: 'https://x/tee.jpg' }], error: null },
    },
  ]
}

describe('createJobTrackerShellForOrder', () => {
  it('inserts a job_trackers row with platform=b2b-portal, status=quote-accepted-mockup, monday_item_id=null and the QuoteData shape /order-tracker renders', async () => {
    const { admin, writes } = makeStub({
      selects: baseSelects(),
      insertResponses: [
        { table: 'job_trackers', data: { id: 't-1' }, error: null },
      ],
    })

    const result = await createJobTrackerShellForOrder(admin, {
      quoteId: QUOTE_ID,
      orderRef: 'ORD-TEST-1',
      organizationId: ORG_ID,
      userId: USER_ID,
      customerEmail: 'BUYER@acme.test',
      customerName: 'Acme Co',
      requiredBy: '2026-06-01',
      orderType: 'stock_on_hand',
      shippingAddress: {
        name: 'Sam Buyer',
        address: '12 Queen St',
        city: 'Auckland',
        postal_code: '1010',
        country: 'NZ',
      },
    })

    expect(result.trackerId).toBe('t-1')
    expect(result.trackerToken).toMatch(/^[0-9a-f-]{36}$/i)

    const inserts = writes.filter((w) => w.table === 'job_trackers' && w.op === 'insert')
    expect(inserts).toHaveLength(1)
    const row = inserts[0].payload as AnyRow

    expect(row.platform).toBe('b2b-portal')
    // Gap b (issue #77): seeded at the Mockup stage to match Monday's fresh-item
    // default "Need: Mockup (Quote Approved)", NOT one stage ahead at Proof Prep.
    expect(row.status).toBe('quote-accepted-mockup')
    expect(row.monday_item_id).toBeNull()
    expect(row.quote_id).toBe(QUOTE_ID)
    expect(row.user_id).toBe(USER_ID)
    expect(row.job_reference).toBe('ORD-TEST-1')
    expect(row.quote_number).toBe('ORD-TEST-1')
    expect(row.customer_email).toBe('buyer@acme.test') // lowercased
    expect(row.customer_name).toBe('Acme Co')
    expect(row.company_id).toBe('COMP-XYZ')
    expect(row.quote_data_source).toBe('submit-quote')
    expect(row.estimated_delivery_at).toBe('2026-06-01')
    expect(row.order_type).toBe('stock_on_hand') // Feature #7 — denormalised



    const productImages = row.product_images as string[]
    expect(productImages).toEqual(['https://x/tee.jpg'])

    const quoteData = row.quote_data as {
      items: AnyRow[]
      summary: { subtotal: number; total: number; artworkTotal: number }
      currencyCode: string
      shippingAddress?: {
        name?: string
        street?: string
        city?: string
        postalCode?: string
        country?: string
      }
    }
    expect(quoteData.summary).toEqual({ subtotal: 100, total: 115, artworkTotal: 10 })
    expect(quoteData.currencyCode).toBe('NZD')
    expect(quoteData.shippingAddress).toEqual({
      name: 'Sam Buyer',
      street: '12 Queen St',
      city: 'Auckland',
      postalCode: '1010',
      country: 'NZ',
    })
    expect(quoteData.items).toHaveLength(1)
    const item = quoteData.items[0] as AnyRow & {
      sizes?: Record<string, number>
      customizations?: { colors?: { garment?: { name: string; hex: string } }; logos?: AnyRow[] }
    }
    expect(item.productName).toBe('Basic Tee')
    expect(item.quantity).toBe(10)
    expect(item.sizes).toEqual({ M: 10 })
    expect(item.customizations?.colors?.garment).toEqual({ name: 'Navy', hex: '#0b1c2c' })
    expect(item.customizations?.logos).toEqual([
      { imageUrl: 'https://x/front.png', printMethod: 'screen' },
    ])
  })

  it('updates an existing tracker row when one already exists for the quote (idempotent)', async () => {
    const selects = baseSelects().map((s) =>
      s.table === 'job_trackers'
        ? { table: 'job_trackers', response: { data: { id: 't-existing', tracker_token: 'TOKEN-PRE-EXISTING' }, error: null } }
        : s,
    )

    const { admin, writes } = makeStub({
      selects,
      updateResponses: [
        { table: 'job_trackers', data: { id: 't-existing' }, error: null },
      ],
    })

    const result = await createJobTrackerShellForOrder(admin, {
      quoteId: QUOTE_ID,
      orderRef: 'ORD-TEST-1',
      organizationId: ORG_ID,
      userId: USER_ID,
      customerEmail: 'buyer@acme.test',
      customerName: 'Acme Co',
      requiredBy: null,
      orderType: 'purchase_order',
      shippingAddress: null,
    })

    expect(result.trackerId).toBe('t-existing')
    expect(result.trackerToken).toBe('TOKEN-PRE-EXISTING') // reused

    const updates = writes.filter((w) => w.table === 'job_trackers' && w.op === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].filters).toEqual([{ column: 'id', value: 't-existing' }])

    const inserts = writes.filter((w) => w.table === 'job_trackers' && w.op === 'insert')
    expect(inserts).toHaveLength(0)
  })

  it('throws when the job_trackers insert errors so the submit best-effort catch can audit', async () => {
    const { admin } = makeStub({
      selects: baseSelects(),
      insertResponses: [
        {
          table: 'job_trackers',
          data: null,
          error: { message: 'simulated insert failure' },
        },
      ],
    })

    await expect(
      createJobTrackerShellForOrder(admin, {
        quoteId: QUOTE_ID,
        orderRef: 'ORD-TEST-2',
        organizationId: ORG_ID,
        userId: USER_ID,
        customerEmail: 'buyer@acme.test',
        customerName: 'Acme Co',
        requiredBy: null,
        orderType: 'purchase_order',
        shippingAddress: null,
      }),
    ).rejects.toThrow(/simulated insert failure/)
  })
})
