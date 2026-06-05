import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks must be declared BEFORE importing the module under test so vitest
// hoists them ahead of the import graph.
// ---------------------------------------------------------------------------

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockRejectedValue(new Error('Monday 500')),
}))

// Order-confirmation email isn't the target of this test; suppress real send.
vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))

// Proof autofill is async + unrelated. Stub to a no-op so we don't drag in the
// proof assembly graph.
vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'
import { pushOrderDeal } from '@/lib/monday/deal-item'

// ---------------------------------------------------------------------------
// Minimal chainable Supabase stub. Every query-builder method returns `this`
// so the call chain resolves to a single thenable when awaited. Each `from`
// call gets recorded so assertions can inspect the writes that happened.
// ---------------------------------------------------------------------------

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
  /** Match by table name + (optional) the most recent in/eq column. Loosest match wins; first registered wins on tie. */
  table: string
  response: SelectResponse
}

function makeSupabaseStub(opts: {
  selects: SelectMatcher[]
  rpcResponses: Record<string, { data: unknown; error: { message: string } | null }>
  /**
   * Override role lookup result for `user_organizations` so getGrantedCatalogueItemIds
   * takes the admin-bypass branch.
   */
  membershipRole: 'org_admin' | 'staff'
}) {
  const writes: RecordedWrite[] = []

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const matchSelect = (): SelectResponse => {
      const hit = opts.selects.find((m) => m.table === table)
      return hit?.response ?? { data: [], error: null }
    }

    const settle = (): SelectResponse | { data: null; error: null } => {
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
      order: (_col: string, _opts?: unknown) => builder,
      limit: (_n: number) => builder,
      single: async () => settle(),
      maybeSingle: async () => {
        const r = settle()
        if (Array.isArray(r.data)) {
          return { data: r.data[0] ?? null, error: r.error }
        }
        return r
      },
      then<R1 = SelectResponse, R2 = never>(
        resolve: (v: SelectResponse) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        try {
          return Promise.resolve(settle() as SelectResponse).then(resolve, reject)
        } catch (err) {
          return Promise.reject(err).then(undefined, reject) as PromiseLike<R2>
        }
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, _args?: unknown) => {
      const r = opts.rpcResponses[name]
      if (!r) return { data: null, error: null }
      return r
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
    // Used by member-access role lookup branch.
    _membershipRole: opts.membershipRole,
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, writes }
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
    },
    idempotency_key: 'idem-test-1',
    required_by: null,
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

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MONDAY_REORDERS_BOARD_ID = '2046357917'
})

describe('submitCustomerOrder — Monday push failure', () => {
  it('still commits the order, flips status to awaiting-proof-review, leaves monday_item_id NULL, and writes one audit row', async () => {
    const { admin, writes } = makeSupabaseStub({
      membershipRole: 'org_admin',
      rpcResponses: {
        effective_unit_price: { data: 10, error: null },
        submit_b2b_order: {
          data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }],
          error: null,
        },
      },
      selects: [
        // user_organizations role lookup → org_admin (member-access admin branch)
        { table: 'user_organizations', response: { data: { role: 'org_admin' }, error: null } },
        // Admin branch listing of granted catalogue items
        { table: 'b2b_catalogue_items', response: {
          data: [
            { id: CAT_ITEM_ID, source_product_id: PRODUCT_ID, moq_override: null },
          ],
          error: null,
        } },
        // products MOQ lookup
        { table: 'products', response: { data: [{ id: PRODUCT_ID, moq: 1 }], error: null } },
        // quote_items: returned for the "apply ship_to_store_id + decorations" loop AND the Monday-deal lines fetch.
        { table: 'quote_items', response: {
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
        } },
        // quotes lookup for email + autofill
        { table: 'quotes', response: {
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
        } },
      ],
    })

    const result = await submitCustomerOrder(admin, buildInput())

    // 1. Returned order id + ref are populated.
    expect(result.order_id).toBe(ORDER_ID)
    expect(result.order_ref).toBe('ORD-TEST-1')

    // 2. pushOrderDeal was attempted and rejected.
    expect(pushOrderDeal).toHaveBeenCalledTimes(1)

    // 3. orders.update was called with status='awaiting-proof-review'.
    const ordersStatusUpdate = writes.find(
      (w) =>
        w.table === 'orders' &&
        w.op === 'update' &&
        (w.payload as AnyRow).status === 'awaiting-proof-review',
    )
    expect(ordersStatusUpdate).toBeDefined()

    // 4. orders.update was NEVER called with a monday_item_id (the try block bailed
    //    before reaching the persist step, so the column stays NULL in prod).
    const mondayItemWrite = writes.find(
      (w) =>
        w.table === 'orders' &&
        w.op === 'update' &&
        Object.prototype.hasOwnProperty.call(w.payload as AnyRow, 'monday_item_id'),
    )
    expect(mondayItemWrite).toBeUndefined()

    // 5. Exactly one audit_events insert with action='order.monday_push_failed'.
    const mondayFailedAudit = writes.filter(
      (w) =>
        w.table === 'audit_events' &&
        w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.monday_push_failed',
    )
    expect(mondayFailedAudit).toHaveLength(1)
    const auditMeta = (mondayFailedAudit[0].payload as AnyRow).metadata as AnyRow
    expect(auditMeta.error).toBe('Monday 500')
    expect(auditMeta.order_ref).toBe('ORD-TEST-1')
  })
})
