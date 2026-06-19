import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (hoisted) — same shape as submit.monday-push-failure.test.ts.
// pushOrderDeal succeeds here so the test doesn't fight the Monday branch.
// ---------------------------------------------------------------------------

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'mky-1', subitemIds: {} }),
}))

vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'

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

interface RpcCallRecord {
  name: string
  args: AnyRow | undefined
}

function makeSupabaseStub(opts: {
  selects: SelectMatcher[]
  rpc: (name: string, args: AnyRow | undefined, callIndex: number) => {
    data: unknown
    error: { message: string } | null
  }
}) {
  const writes: RecordedWrite[] = []
  const rpcCalls: RpcCallRecord[] = []

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
      select: (_cols?: string) => builder,
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
      gt: (_column: string, _value: unknown) => builder,
      order: (_col: string, _opts?: unknown) => builder,
      limit: (_n: number) => builder,
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
        try {
          return Promise.resolve(settle()).then(resolve, reject)
        } catch (err) {
          return Promise.reject(err).then(undefined, reject) as PromiseLike<R2>
        }
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      const callIndex = rpcCalls.filter((c) => c.name === name).length
      rpcCalls.push({ name, args })
      return opts.rpc(name, args, callIndex)
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, writes, rpcCalls }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_ID = '00000000-0000-0000-0000-000000000aaa'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000bbb'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'
const ORDER_ID = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID = '00000000-0000-0000-0000-000000000222'
const VARIANT_ID = '00000000-0000-0000-0000-000000000333'
const QUOTE_ITEM_ID = 'qi-1'

function buildInput(
  overrides: Partial<Pick<CheckoutInput, 'intent'>> = {},
): CheckoutInput {
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
    idempotency_key: 'idem-test-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    lines: [
      {
        product_id: PRODUCT_ID,
        product_name: 'Basic Tee',
        variant_id: VARIANT_ID,
        qty: 10,
        decorations: [],
        cart_line_id: 'line-1',
        fulfilment_type: 'stocked',
      },
    ],
    ...overrides,
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
            id: QUOTE_ITEM_ID,
            product_id: PRODUCT_ID,
            variant_id: VARIANT_ID,
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
          required_by: null,
          payment_terms: 'net20',
        },
        error: null,
      },
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MONDAY_REORDERS_BOARD_ID = '2046357917'
})

describe('submitCustomerOrder — pre-approved inventory write-through', () => {
  it('calls mark_inventory_received once per line and writes the success audit row when intent=inventory', async () => {
    const { admin, writes, rpcCalls } = makeSupabaseStub({
      selects: baseSelects(),
      rpc: (name) => {
        if (name === 'effective_unit_price') return { data: 10, error: null }
        if (name === 'submit_b2b_order') {
          return {
            data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }],
            error: null,
          }
        }
        if (name === 'mark_inventory_received') {
          return {
            data: [{ variant_inventory_id: 'vi-1', stock_qty: 10, committed_qty: 0, event_id: 'ev-1' }],
            error: null,
          }
        }
        return { data: null, error: null }
      },
    })

    const result = await submitCustomerOrder(admin, buildInput({ intent: 'inventory' }))

    expect(result.order_id).toBe(ORDER_ID)

    const invCalls = rpcCalls.filter((c) => c.name === 'mark_inventory_received')
    expect(invCalls).toHaveLength(1)
    expect(invCalls[0].args).toMatchObject({
      p_organization_id: ORG_ID,
      p_variant_id: VARIANT_ID,
      p_qty: 10,
      p_prepaid: false,
      p_unit_value: 10,
      p_reason: 'pre_approved_inventory',
      p_reference_quote_item_id: QUOTE_ITEM_ID,
    })
    expect(invCalls[0].args?.p_note).toMatch(/Pre-approved at checkout — order ORD-TEST-1/)

    // Success audit row landed.
    const auditRows = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.pre_approved_inventory',
    )
    expect(auditRows).toHaveLength(1)
    const auditMeta = (auditRows[0].payload as AnyRow).metadata as AnyRow
    expect(auditMeta.order_ref).toBe('ORD-TEST-1')
    expect(auditMeta.quote_id).toBe(QUOTE_ID)
    expect(auditMeta.line_count).toBe(1)
    expect(auditMeta.skipped).toEqual([])

    // Failure audit row must NOT be present on the happy path.
    const failureAudits = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.pre_approved_inventory_failed',
    )
    expect(failureAudits).toHaveLength(0)
  })

  it('still commits the order and writes the failure audit row when mark_inventory_received errors', async () => {
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
        if (name === 'mark_inventory_received') {
          return { data: null, error: { message: 'simulated RPC failure' } }
        }
        return { data: null, error: null }
      },
    })

    const result = await submitCustomerOrder(admin, buildInput({ intent: 'inventory' }))

    // Order still commits — the customer flow never sees the inventory-write failure.
    expect(result.order_id).toBe(ORDER_ID)
    expect(result.order_ref).toBe('ORD-TEST-1')

    // Exactly one failure audit row.
    const failureAudits = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.pre_approved_inventory_failed',
    )
    expect(failureAudits).toHaveLength(1)
    const meta = (failureAudits[0].payload as AnyRow).metadata as AnyRow
    expect(meta.order_ref).toBe('ORD-TEST-1')
    expect(typeof meta.error).toBe('string')
    expect(meta.error).toContain('simulated RPC failure')

    // Success audit row must NOT have been written on the failure path.
    const successAudits = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.pre_approved_inventory',
    )
    expect(successAudits).toHaveLength(0)
  })

  it('never calls mark_inventory_received when intent=customer (default)', async () => {
    const { admin, rpcCalls } = makeSupabaseStub({
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

    // intent omitted ⇒ defaults to 'customer' inside submitCustomerOrder.
    await submitCustomerOrder(admin, buildInput())

    const invCalls = rpcCalls.filter((c) => c.name === 'mark_inventory_received')
    expect(invCalls).toHaveLength(0)
  })
})
