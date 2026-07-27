import { describe, it, expect, vi, beforeEach } from 'vitest'

// Deferred side-effects — stub the whole graph so we assert only on whether the
// dispatch-once guard let them run.
vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'item-1', subitemIds: {} }),
}))
vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))
const { sendOrderPlacedDispatch } = vi.hoisted(() => ({
  sendOrderPlacedDispatch: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/email/order-placed-dispatch', () => ({ sendOrderPlacedDispatch }))
vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))
vi.mock('@/lib/xero/draft-invoice', () => ({
  createDraftInvoiceForOrder: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'test' }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'
import { pushOrderDeal } from '@/lib/monday/deal-item'
import { sendOrderConfirmation } from '@/lib/email/order-confirmation'

const flushAfter = () =>
  (globalThis as unknown as { flushAfter: () => Promise<void> }).flushAfter()

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_ID = '00000000-0000-0000-0000-000000000aaa'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000bbb'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'
const ORDER_ID = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID = '00000000-0000-0000-0000-000000000222'

type AnyRow = Record<string, unknown>
interface SelectResponse {
  data: AnyRow | AnyRow[] | null
  error: { message: string } | null
}

/**
 * Chainable Supabase stub whose `orders` UPDATE ... .is('notifications_dispatched_at', null)
 * .select('id') (the dispatch-once compare-and-set) returns a configurable array:
 * `[{ id }]` = this submit won the claim (fresh) → side-effects run; `[]` =
 * another submit already claimed it (replay) → side-effects skip.
 */
function makeSupabaseStub(opts: {
  selects: Array<{ table: string; response: SelectResponse }>
  rpcResponses: Record<string, { data: unknown; error: { message: string } | null }>
  claimResult: AnyRow[]
}) {
  function builderFor(table: string) {
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow } | null = null

    const matchSelect = (): SelectResponse =>
      opts.selects.find((m) => m.table === table)?.response ?? { data: [], error: null }

    const settle = (): SelectResponse => {
      if (pendingWrite) {
        // The dispatch-once claim: orders UPDATE carrying notifications_dispatched_at.
        if (
          table === 'orders' &&
          pendingWrite.op === 'update' &&
          Object.prototype.hasOwnProperty.call(pendingWrite.payload, 'notifications_dispatched_at')
        ) {
          return { data: opts.claimResult, error: null }
        }
        return { data: null, error: null }
      }
      return matchSelect()
    }

    const builder = {
      select: () => builder,
      insert: (payload: AnyRow) => {
        pendingWrite = { op: 'insert', payload }
        return builder
      },
      update: (payload: AnyRow) => {
        pendingWrite = { op: 'update', payload }
        return builder
      },
      eq: () => builder,
      in: () => builder,
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
      then<R1 = SelectResponse, R2 = never>(
        resolve: (v: SelectResponse) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        return Promise.resolve(settle()).then(resolve, reject)
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string) => opts.rpcResponses[name] ?? { data: null, error: null }),
    auth: {
      admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin }
}

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
      branchStoreIds: [],
      tenantType: null,
      allowsMultiStoreOrdering: false,
      moqExempt: true,
      orderingPermission: 'both',
    },
    idempotency_key: 'idem-dispatch-once',
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

/** claimed=true → guard claims [{id}] (fresh, run); false → guard gets [] (replay, skip). */
function buildStubWithClaim(claimed: boolean) {
  return makeSupabaseStub({
    claimResult: claimed ? [{ id: ORDER_ID }] : [],
    rpcResponses: {
      effective_unit_price: { data: 10, error: null },
      submit_b2b_order: {
        data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }],
        error: null,
      },
    },
    selects: [
      { table: 'user_organizations', response: { data: { role: 'org_admin' }, error: null } },
      { table: 'b2b_catalogue_items', response: { data: [{ id: CAT_ITEM_ID, source_product_id: PRODUCT_ID, moq_override: null }], error: null } },
      { table: 'products', response: { data: [{ id: PRODUCT_ID, moq: 1 }], error: null } },
      { table: 'quote_items', response: { data: [{ id: 'qi-1', product_id: PRODUCT_ID, variant_id: null, size_id: null, product_name: 'Basic Tee', quantity: 10, unit_price: 10, decorations: [], size_label: null, product_variants: null }], error: null } },
      { table: 'quotes', response: { data: { id: QUOTE_ID, organization_id: ORG_ID, customer_name: 'Acme Co', customer_email: 'buyer@acme.test', order_ref: 'ORD-TEST-1', total_amount: 100, required_by: null, payment_terms: 'net20' }, error: null } },
      // Real (non-test) org so the dispatch email would fire when the guard lets it.
      { table: 'organizations', response: { data: { is_test: false }, error: null } },
    ],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('submitCustomerOrder — dispatch-once guard', () => {
  it('runs the external side-effects exactly once when the order is claimed fresh', async () => {
    const { admin } = buildStubWithClaim(true)
    const result = await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    expect(result).toEqual({ order_id: ORDER_ID, order_ref: 'ORD-TEST-1' })
    expect(pushOrderDeal).toHaveBeenCalledOnce()
    expect(sendOrderConfirmation).toHaveBeenCalledOnce()
    expect(sendOrderPlacedDispatch).toHaveBeenCalledOnce()
  })

  it('skips ALL external side-effects when the order was already claimed (replay)', async () => {
    const { admin } = buildStubWithClaim(false)
    const result = await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    // Order still returns normally — only the deferred notifications are suppressed.
    expect(result).toEqual({ order_id: ORDER_ID, order_ref: 'ORD-TEST-1' })
    expect(pushOrderDeal).not.toHaveBeenCalled()
    expect(sendOrderConfirmation).not.toHaveBeenCalled()
    expect(sendOrderPlacedDispatch).not.toHaveBeenCalled()
  })
})
