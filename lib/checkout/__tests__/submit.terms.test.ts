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
vi.mock('@/lib/orders/job-tracker', () => ({
  createJobTrackerShellForOrder: vi
    .fn()
    .mockResolvedValue({ trackerId: 't-test', trackerToken: 'TOKEN-X' }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'

const flushAfter = () =>
  (globalThis as unknown as { flushAfter: () => Promise<void> }).flushAfter()

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
  /**
   * When present and it returns true for an INSERT, the stub throws synchronously
   * instead of recording the write — exercises submit.ts's best-effort try/catch
   * around the TERMS_ACCEPTED write (recordAuditEvent swallows a RETURNED {error},
   * so only a thrown/rejected insert reaches submit.ts's guard).
   */
  failInsertWhen?: (table: string, payload: AnyRow) => boolean
}) {
  const writes: RecordedWrite[] = []

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const matchSelect = (): SelectResponse =>
      opts.selects.find((m) => m.table === table)?.response ?? { data: [], error: null }

    const settle = (): SelectResponse => {
      if (pendingWrite) {
        if (
          pendingWrite.op === 'insert' &&
          opts.failInsertWhen?.(table, pendingWrite.payload as AnyRow)
        ) {
          throw new Error('audit insert boom')
        }
        writes.push({ table, op: pendingWrite.op, payload: pendingWrite.payload, filters: [...filters] })
        return { data: null, error: null }
      }
      return matchSelect()
    }

    const builder = {
      select: () => builder,
      insert: (payload: AnyRow | AnyRow[]) => { pendingWrite = { op: 'insert', payload }; return builder },
      update: (payload: AnyRow) => { pendingWrite = { op: 'update', payload }; return builder },
      eq: (column: string, value: unknown) => { filters.push({ column, value }); return builder },
      in: (column: string, value: unknown) => { filters.push({ column, value }); return builder },
      is: (column: string, value: unknown) => { filters.push({ column, value }); return builder },
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
      admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
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
      userId: USER_ID, membershipId: MEMBERSHIP_ID, role: 'org_admin',
      email: 'buyer@acme.test', fullName: 'Sam Buyer', organizationId: ORG_ID,
      organizationName: 'Acme Co', customerCode: 'ACME', isTest: false,
      b2bAccountId: null, tierLevel: null, paymentTerms: 'net20', contractNotes: null,
      pricingMode: null, defaultDepositPercent: null, storeIds: [], defaultStoreId: null,
      branchStoreIds: [], tenantType: null, allowsMultiStoreOrdering: false,
      moqExempt: true, minOrderExempt: true, orderingPermission: 'both',
    },
    idempotency_key: 'idem-terms-1',
    required_by: '2026-06-01',
    notes: null,
    internal_notes: null,
    lines: [
      {
        product_id: PRODUCT_ID, product_name: 'Basic Tee', variant_id: null,
        qty: 10, decorations: [], cart_line_id: 'line-1', fulfilment_type: 'stocked',
      },
    ],
    terms_accepted: true,
    terms_version: 'v1-2026-08-11',
  }
}

function baseSelects(): SelectMatcher[] {
  return [
    { table: 'user_organizations', response: { data: { role: 'org_admin' }, error: null } },
    {
      table: 'b2b_catalogue_items',
      response: { data: [{ id: CAT_ITEM_ID, source_product_id: PRODUCT_ID, moq_override: null }], error: null },
    },
    { table: 'products', response: { data: [{ id: PRODUCT_ID, moq: 1 }], error: null } },
    {
      table: 'quote_items',
      response: {
        data: [{
          id: 'qi-1', product_id: PRODUCT_ID, variant_id: null, product_name: 'Basic Tee',
          quantity: 10, unit_price: 10, decorations: [], product_variants: null,
        }],
        error: null,
      },
    },
    {
      table: 'quotes',
      response: {
        data: {
          id: QUOTE_ID, organization_id: ORG_ID, customer_name: 'Acme Co',
          customer_email: 'buyer@acme.test', order_ref: 'ORD-TEST-1', total_amount: 100,
          required_by: '2026-06-01', payment_terms: 'net20',
        },
        error: null,
      },
    },
  ]
}

const rpc = (name: string) => {
  if (name === 'effective_unit_price') return { data: 10, error: null }
  if (name === 'submit_b2b_order_for_country') {
    return { data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }], error: null }
  }
  return { data: null, error: null }
}

beforeEach(() => { vi.clearAllMocks() })

describe('submitCustomerOrder — Terms & Conditions consent trail', () => {
  it('writes a TERMS_ACCEPTED audit row carrying the version, order_ref and idempotency_key', async () => {
    const { admin, writes } = makeSupabaseStub({ selects: baseSelects(), rpc })
    await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    const termsAudits = writes.filter(
      (w) => w.table === 'audit_events' && w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.terms_accepted',
    )
    expect(termsAudits).toHaveLength(1)
    const meta = (termsAudits[0].payload as AnyRow).metadata as AnyRow
    expect(meta.terms_version).toBe('v1-2026-08-11')
    expect(meta.order_ref).toBe('ORD-TEST-1')
    expect(meta.idempotency_key).toBe('idem-terms-1')
    expect((termsAudits[0].payload as AnyRow).target_id).toBe(ORDER_ID)
  })

  it('folds terms_version into the ORDER_SUBMIT audit metadata (redundant reliable copy)', async () => {
    const { admin, writes } = makeSupabaseStub({ selects: baseSelects(), rpc })
    await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    const submitAudits = writes.filter(
      (w) => w.table === 'audit_events' && w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.submit',
    )
    expect(submitAudits).toHaveLength(1)
    const meta = (submitAudits[0].payload as AnyRow).metadata as AnyRow
    expect(meta.terms_version).toBe('v1-2026-08-11')
  })

  it('still commits the order (no 500) when the TERMS_ACCEPTED audit write throws', async () => {
    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects(),
      rpc,
      failInsertWhen: (table, payload) =>
        table === 'audit_events' && payload.action === 'order.terms_accepted',
    })

    // Must RESOLVE with the committed order — a thrown best-effort consent write
    // must never turn a committed order into a 500.
    const result = await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    expect(result.order_id).toBe(ORDER_ID)
    expect(result.order_ref).toBe('ORD-TEST-1')

    // The failure was isolated to the terms write: the ORDER_SUBMIT audit row
    // (written first, before the guarded terms write) still landed, proving the
    // commit path completed.
    const submitAudits = writes.filter(
      (w) => w.table === 'audit_events' && w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.submit',
    )
    expect(submitAudits.length).toBeGreaterThanOrEqual(1)

    // And the terms row itself was NOT recorded (its insert threw).
    const termsAudits = writes.filter(
      (w) => w.table === 'audit_events' && w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.terms_accepted',
    )
    expect(termsAudits).toHaveLength(0)
  })
})
