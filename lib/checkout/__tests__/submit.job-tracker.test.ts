import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: '12345', subitemIds: {} }),
}))

vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))

// Stub the helper so this test focuses on the wiring in submit.ts — the
// helper itself is exercised in lib/orders/__tests__/job-tracker.test.ts.
vi.mock('@/lib/orders/job-tracker', () => ({
  createJobTrackerShellForOrder: vi
    .fn()
    .mockResolvedValue({ trackerId: 't-test', trackerToken: 'TOKEN-X' }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'

// The Monday-id attach (5a) now runs in Next's after(); flush the deferred work
// (run immediately by the vitest.setup mock) before asserting on it.
const flushAfter = () =>
  (globalThis as unknown as { flushAfter: () => Promise<void> }).flushAfter()
import { createJobTrackerShellForOrder } from '@/lib/orders/job-tracker'
const createJobTrackerShellForOrderMock = vi.mocked(createJobTrackerShellForOrder)

type AnyRow = Record<string, unknown>

interface RecordedWrite {
  table: string
  op: 'insert' | 'update'
  payload: AnyRow | AnyRow[]
  filters: Array<{ column: string; value: unknown }>
}

interface SelectResponse {
  data: AnyRow | AnyRow[] | null
  error: { message: string } | null
}

interface SelectMatcher {
  table: string
  response: SelectResponse
}

function makeSupabaseStub(opts: {
  selects: SelectMatcher[]
  rpc: (name: string, args: AnyRow | undefined, callIndex: number) => {
    data: unknown
    error: { message: string } | null
  }
}) {
  const writes: RecordedWrite[] = []

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const matchSelect = (): SelectResponse =>
      opts.selects.find((m) => m.table === table)?.response ?? { data: [], error: null }

    const settle = (): SelectResponse => {
      if (pendingWrite) {
        writes.push({ table, op: pendingWrite.op, payload: pendingWrite.payload, filters: [...filters] })
        return { data: null, error: null }
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
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => settle(),
      maybeSingle: async () => {
        const r = settle()
        if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error }
        return r
      },
      then<R1 = SelectResponse, R2 = never>(
        resolve: (v: SelectResponse) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        return Promise.resolve(settle()).then(resolve, reject)
      },
    }
    return builder
  }

  const rpcCalls: Array<{ name: string; args: AnyRow | undefined }> = []
  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      rpcCalls.push({ name, args })
      const callIndex = rpcCalls.filter((c) => c.name === name).length - 1
      return opts.rpc(name, args, callIndex)
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, writes }
}

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_ID = '00000000-0000-0000-0000-000000000aaa'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000bbb'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'
const ORDER_ID = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID = '00000000-0000-0000-0000-000000000222'

function buildInput(): CheckoutInput {
  return {
    context: {
      userId: USER_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'org_admin',
      email: 'buyer@acme.test',
      fullName: 'Sam Buyer',
      organizationId: ORG_ID,
      organizationName: 'Acme Co',
      customerCode: 'ACME',
      isTest: false,
      b2bAccountId: null,
      tierLevel: null,
      paymentTerms: 'net20',
      contractNotes: null,
      pricingMode: null,
      defaultDepositPercent: null,
      storeIds: [],
      defaultStoreId: null,
      tenantType: null,
      allowsMultiStoreOrdering: false,
      moqExempt: true,
      orderingPermission: 'both',
    },
    idempotency_key: 'idem-test-jt',
    required_by: '2026-06-01',
    notes: null,
    internal_notes: null,
    lines: [
      {
        product_id: PRODUCT_ID,
        product_name: 'Basic Tee',
        variant_id: null,
        qty: 10,
        decorations: [],
        cart_line_id: 'line-1',
        fulfilment_type: 'stocked',
      },
    ],
  }
}

function baseSelects(): SelectMatcher[] {
  return [
    { table: 'user_organizations', response: { data: { role: 'org_admin' }, error: null } },
    {
      table: 'b2b_catalogue_items',
      response: {
        data: [{ id: CAT_ITEM_ID, source_product_id: PRODUCT_ID, moq_override: null }],
        error: null,
      },
    },
    { table: 'products', response: { data: [{ id: PRODUCT_ID, moq: 1 }], error: null } },
    {
      table: 'quote_items',
      response: {
        data: [
          {
            id: 'qi-1',
            product_id: PRODUCT_ID,
            variant_id: null,
            product_name: 'Basic Tee',
            quantity: 10,
            unit_price: 10,
            decorations: [],
            product_variants: null,
          },
        ],
        error: null,
      },
    },
    {
      table: 'quotes',
      response: {
        data: {
          id: QUOTE_ID,
          organization_id: ORG_ID,
          customer_name: 'Acme Co',
          customer_email: 'buyer@acme.test',
          order_ref: 'ORD-TEST-1',
          total_amount: 100,
          required_by: '2026-06-01',
          payment_terms: 'net20',
        },
        error: null,
      },
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  createJobTrackerShellForOrderMock.mockResolvedValue({ trackerId: 't-test', trackerToken: 'TOKEN-X' })
})

describe('submitCustomerOrder — job tracker step 4c + Monday id attach (5a)', () => {
  it('calls createJobTrackerShellForOrder with the customer userId and writes the success audit row', async () => {
    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects(),
      rpc: (name) => {
        if (name === 'effective_unit_price') return { data: 10, error: null }
        if (name === 'submit_b2b_order') {
          return {
            data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }],
            error: null,
          }
        }
        return { data: null, error: null }
      },
    })

    await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    expect(createJobTrackerShellForOrderMock).toHaveBeenCalledTimes(1)
    expect(createJobTrackerShellForOrderMock).toHaveBeenCalledWith(admin, {
      quoteId: QUOTE_ID,
      orderRef: 'ORD-TEST-1',
      organizationId: ORG_ID,
      userId: USER_ID,
      customerEmail: 'buyer@acme.test',
      customerName: 'Acme Co',
      requiredBy: '2026-06-01',
      orderType: 'purchase_order',
      shippingAddress: {},
    })

    const createdAudits = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.job_tracker_created',
    )
    expect(createdAudits).toHaveLength(1)

    // No failure audit on the happy path.
    const failureAudits = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        ((w.payload as AnyRow).action === 'order.job_tracker_create_failed' ||
          (w.payload as AnyRow).action === 'order.job_tracker_monday_link_failed'),
    )
    expect(failureAudits).toHaveLength(0)
  })

  it('still commits the order and writes order.job_tracker_create_failed when the helper throws', async () => {
    createJobTrackerShellForOrderMock.mockRejectedValueOnce(new Error('simulated helper failure'))

    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects(),
      rpc: (name) => {
        if (name === 'effective_unit_price') return { data: 10, error: null }
        if (name === 'submit_b2b_order') {
          return {
            data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }],
            error: null,
          }
        }
        return { data: null, error: null }
      },
    })

    const result = await submitCustomerOrder(admin, buildInput())
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    expect(result.order_ref).toBe('ORD-TEST-1')

    const failureAudits = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.job_tracker_create_failed',
    )
    expect(failureAudits).toHaveLength(1)
    const meta = (failureAudits[0].payload as AnyRow).metadata as AnyRow
    expect(meta.error).toContain('simulated helper failure')
  })

  it('after a successful Monday push, updates job_trackers.monday_item_id keyed by quote_id', async () => {
    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects(),
      rpc: (name) => {
        if (name === 'effective_unit_price') return { data: 10, error: null }
        if (name === 'submit_b2b_order') {
          return {
            data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }],
            error: null,
          }
        }
        return { data: null, error: null }
      },
    })

    await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    const trackerUpdates = writes.filter(
      (w) =>
        w.table === 'job_trackers' &&
        w.op === 'update' &&
        (w.payload as AnyRow).monday_item_id === 12345,
    )
    expect(trackerUpdates).toHaveLength(1)
    expect(trackerUpdates[0].filters).toEqual([{ column: 'quote_id', value: QUOTE_ID }])
  })
})
