import { describe, it, expect, vi, beforeEach } from 'vitest'

// Side-effects are irrelevant to the atomic per-line snapshot plan under test;
// stub the same graph the sibling submit tests do so we don't drag in Monday,
// email or proof assembly.
vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'item-1', subitemIds: {} }),
}))
vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/email/order-placed-dispatch', () => ({
  sendOrderPlacedDispatch: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'

const P1 = '00000000-0000-0000-0000-000000000001'
const P2 = '00000000-0000-0000-0000-000000000002'
const P3 = '00000000-0000-0000-0000-000000000003'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'

/**
 * Minimal chainable Supabase stub focused on the submit RPC boundary. Any
 * post-commit `quote_items` UPDATE is recorded so the test can prove artwork
 * provenance no longer depends on one.
 */
function makeStub() {
  const updates: Array<{ id: unknown; payload: Record<string, unknown> }> = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  const selects: Record<string, { data: unknown; error: null }> = {
    user_organizations: { data: { role: 'org_admin' }, error: null },
    b2b_catalogue_items: {
      data: [
        { id: 'cat-1', source_product_id: P1, moq_override: null },
        { id: 'cat-2', source_product_id: P2, moq_override: null },
        { id: 'cat-3', source_product_id: P3, moq_override: null },
      ],
      error: null,
    },
    products: {
      data: [
        { id: P1, moq: 1 },
        { id: P2, moq: 1 },
        { id: P3, moq: 1 },
      ],
      error: null,
    },
    quote_items: {
      data: [
        { id: 'qi-1', product_id: P1, variant_id: null, size_id: null, product_name: 'Tee A', quantity: 10, unit_price: 10, decorations: [], size_label: null, product_variants: null },
        { id: 'qi-2', product_id: P2, variant_id: null, size_id: null, product_name: 'Tee B', quantity: 10, unit_price: 10, decorations: [], size_label: null, product_variants: null },
        { id: 'qi-3', product_id: P3, variant_id: null, size_id: null, product_name: 'Tee C', quantity: 10, unit_price: 10, decorations: [], size_label: null, product_variants: null },
      ],
      error: null,
    },
    quotes: {
      data: {
        id: 'quote-1',
        organization_id: ORG_ID,
        customer_name: 'Acme Co',
        customer_email: 'buyer@acme.test',
        order_ref: 'ORD-BATCH-1',
        total_amount: 300,
        required_by: null,
        payment_terms: 'net20',
      },
      error: null,
    },
    organizations: { data: { is_test: true }, error: null },
  }

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let write: { op: 'insert' | 'update'; payload: Record<string, unknown> } | null = null

    const settle = () => {
      if (write) return { data: null, error: null }
      return selects[table] ?? { data: [], error: null }
    }

    const builder = {
      select: () => builder,
      insert: (p: Record<string, unknown>) => {
        write = { op: 'insert', payload: p }
        return builder
      },
      update: (p: Record<string, unknown>) => {
        write = { op: 'update', payload: p }
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
      is: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => {
        const r = settle()
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }
      },
      maybeSingle: async () => {
        const r = settle()
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }
      },
      then<R1, R2 = never>(
        resolve: (v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        if (write?.op === 'update' && table === 'quote_items') {
          const idFilter = filters.find((f) => f.column === 'id')
          updates.push({ id: idFilter?.value, payload: write.payload })
          return Promise.resolve({ data: null, error: null }).then(resolve, reject)
        }
        return Promise.resolve(settle()).then(resolve, reject)
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      if (name === 'effective_unit_price' || name === 'effective_unit_price_for_item') {
        return { data: 10, error: null }
      }
      if (name === 'submit_b2b_order_for_country') {
        return { data: [{ quote_id: 'quote-1', order_id: 'order-1', order_ref: 'ORD-BATCH-1' }], error: null }
      }
      return { data: null, error: null }
    }),
    auth: {
      admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, updates, rpcCalls }
}

function line(productId: string, name: string, cartLineId: string): CheckoutInput['lines'][number] {
  return {
    product_id: productId,
    product_name: name,
    variant_id: null,
    qty: 10,
    decorations: [],
    cart_line_id: cartLineId,
    fulfilment_type: 'stocked',
  }
}

function buildInput(): CheckoutInput {
  return {
    context: {
      userId: '00000000-0000-0000-0000-000000000ccc',
      membershipId: '00000000-0000-0000-0000-000000000bbb',
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
      branchStoreIds: [],
      tenantType: null,
      allowsMultiStoreOrdering: false,
      moqExempt: true,
      orderingPermission: 'both',
    },
    idempotency_key: 'idem-batch-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    lines: [line(P1, 'Tee A', 'l1'), line(P2, 'Tee B', 'l2'), line(P3, 'Tee C', 'l3')],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('submitCustomerOrder — atomic rendition snapshot plan', () => {
  it('sends every line to the transactional RPC and performs no post-commit artwork update', async () => {
    const { admin, updates, rpcCalls } = makeStub()
    await submitCustomerOrder(admin, buildInput())

    expect(updates).toEqual([])
    expect(
      rpcCalls.find(({ name }) => name === 'submit_b2b_order_for_country')?.args
        .p_rendition_snapshot_plan,
    ).toEqual({
      mode: 'provided',
      lines: [
        { line_ordinal: 1, decorations: [] },
        { line_ordinal: 2, decorations: [] },
        { line_ordinal: 3, decorations: [] },
      ],
    })
  })
})
