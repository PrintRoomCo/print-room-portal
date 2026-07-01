import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (hoisted)
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
import type { B2BCustomerContext } from '../server'

// ---------------------------------------------------------------------------
// Supabase stub (mirrors submit.pre-approved-inventory.test.ts pattern)
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>

interface SelectMatcher {
  table: string
  response: { data: AnyRow | AnyRow[] | null; error: { message: string } | null }
}

function makeSupabaseStub(opts: {
  selects: SelectMatcher[]
  rpc: (name: string, args: AnyRow | undefined) => { data: unknown; error: { message: string } | null }
}) {
  const rpc = vi.fn(async (name: string, args?: AnyRow) => opts.rpc(name, args))

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const matchSelect = () =>
      opts.selects.find((m) => m.table === table)?.response ?? { data: [], error: null }

    const settle = () => {
      if (pendingWrite) return { data: null, error: null }
      return matchSelect()
    }

    const builder: Record<string, unknown> = {
      select: (_cols?: string) => builder,
      insert: (payload: AnyRow | AnyRow[]) => { pendingWrite = { op: 'insert', payload }; return builder },
      update: (payload: AnyRow) => { pendingWrite = { op: 'update', payload }; return builder },
      eq: (_col: string, _val: unknown) => { filters.push({ column: _col, value: _val }); return builder },
      in: (_col: string, _val: unknown) => { filters.push({ column: _col, value: _val }); return builder },
      is: (_col: string, _val: unknown) => { filters.push({ column: _col, value: _val }); return builder },
      gt: (_col: string, _val: unknown) => builder,
      order: (_col: string, _opts?: unknown) => builder,
      limit: (_n: number) => builder,
      single: async () => settle(),
      maybeSingle: async () => {
        const r = settle()
        if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error }
        return r
      },
      then<R1 = unknown, R2 = never>(
        resolve: (v: unknown) => R1 | PromiseLike<R1>,
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
    rpc,
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, rpc }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_ID = '00000000-0000-0000-0000-000000000aaa'
const ORG_ID    = '00000000-0000-0000-0000-0000000000ff'
const ORDER_ID  = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID  = '00000000-0000-0000-0000-000000000222'
const VARIANT_ID = '00000000-0000-0000-0000-000000000333'

function ctx(overrides: Partial<B2BCustomerContext> = {}): B2BCustomerContext {
  return {
    userId: 'u1', membershipId: 'm1', role: 'org_admin', email: 'a@b.co',
    fullName: 'A', organizationId: ORG_ID, organizationName: 'Org',
    customerCode: 'PRT', b2bAccountId: 'b1', tierLevel: 1, paymentTerms: 'net20',
    contractNotes: null, pricingMode: null, defaultDepositPercent: null, storeIds: [],
    defaultStoreId: null, tenantType: null, allowsMultiStoreOrdering: false,
    moqExempt: true, orderingPermission: 'both', ...overrides,
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
          id: 'qi-1', product_id: PRODUCT_ID, variant_id: VARIANT_ID,
          product_name: 'Basic Tee', quantity: 10, unit_price: 10,
          decorations: [], product_variants: null,
        }],
        error: null,
      },
    },
    {
      table: 'quotes',
      response: {
        data: {
          id: QUOTE_ID, organization_id: ORG_ID, customer_name: 'Org',
          customer_email: 'a@b.co', order_ref: 'ORD-TEST-1', total_amount: 100,
          required_by: null, payment_terms: 'net20',
        },
        error: null,
      },
    },
  ]
}

function buildInput(permission: B2BCustomerContext['orderingPermission']): CheckoutInput {
  return {
    context: ctx({ orderingPermission: permission }),
    idempotency_key: 'idem-perm-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    lines: [{
      product_id: PRODUCT_ID,
      product_name: 'Basic Tee',
      variant_id: VARIANT_ID,
      qty: 10,
      decorations: [],
      cart_line_id: 'line-1',
      fulfilment_type: 'stocked',
    }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('submitCustomerOrder — p_member_permission threading', () => {
  it('passes p_member_permission: stock_only to submit_b2b_order when context.orderingPermission is stock_only', async () => {
    const { admin, rpc } = makeSupabaseStub({
      selects: baseSelects(),
      rpc: (name) => {
        if (name === 'effective_unit_price') return { data: 10, error: null }
        if (name === 'submit_b2b_order') {
          return { data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }], error: null }
        }
        return { data: null, error: null }
      },
    })

    await submitCustomerOrder(admin, buildInput('stock_only'))

    expect(rpc).toHaveBeenCalledWith(
      'submit_b2b_order',
      expect.objectContaining({ p_member_permission: 'stock_only' }),
    )
  })

  it('passes p_member_permission: both when context.orderingPermission is both', async () => {
    const { admin, rpc } = makeSupabaseStub({
      selects: baseSelects(),
      rpc: (name) => {
        if (name === 'effective_unit_price') return { data: 10, error: null }
        if (name === 'submit_b2b_order') {
          return { data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }], error: null }
        }
        return { data: null, error: null }
      },
    })

    await submitCustomerOrder(admin, buildInput('both'))

    expect(rpc).toHaveBeenCalledWith(
      'submit_b2b_order',
      expect.objectContaining({ p_member_permission: 'both' }),
    )
  })
})
