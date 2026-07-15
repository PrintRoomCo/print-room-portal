import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (hoisted) — same shape as submit.pre-approved-inventory.test.ts, plus
// the Xero orchestrator so we can assert the drawsStock input it receives.
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

vi.mock('@/lib/monday/updates', () => ({
  postItemUpdate: vi.fn().mockResolvedValue(undefined),
}))

const { createDraftInvoiceForOrder } = vi.hoisted(() => ({
  createDraftInvoiceForOrder: vi
    .fn()
    .mockResolvedValue({ status: 'skipped', reason: 'disabled' }),
}))
vi.mock('@/lib/xero/draft-invoice', () => ({ createDraftInvoiceForOrder }))

import {
  submitCustomerOrder,
  MoqViolationError,
  type CheckoutInput,
} from '../submit'

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
  lineOverrides: Partial<CheckoutInput['lines'][number]> = {},
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
      moqExempt: false, // MOQ ENFORCED — this suite tests the MOQ × fulfilment interaction
      orderingPermission: 'both',
    },
    idempotency_key: 'idem-fulfilment-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    lines: [
      {
        product_id: PRODUCT_ID,
        product_name: 'Acrylic Cap',
        variant_id: VARIANT_ID,
        qty: 10, // below MOQ 24 — only passes if the line escapes MOQ as 'stocked'
        decorations: [],
        cart_line_id: 'line-1',
        fulfilment_type: 'stocked', // the (possibly false) client claim under test
        ...lineOverrides,
      },
    ],
  }
}

function baseSelects(opts: {
  productNature: string
  itemNatureOverride?: string | null
}): SelectMatcher[] {
  return [
    { table: 'user_organizations', response: { data: { role: 'org_admin' }, error: null } },
    {
      table: 'b2b_catalogue_items',
      response: {
        data: [
          {
            id: CAT_ITEM_ID,
            source_product_id: PRODUCT_ID,
            moq_override: null,
            fulfilment_type_override: opts.itemNatureOverride ?? null,
          },
        ],
        error: null,
      },
    },
    {
      table: 'products',
      response: {
        data: [{ id: PRODUCT_ID, moq: 24, fulfilment_type: opts.productNature }],
        error: null,
      },
    },
    {
      table: 'quote_items',
      response: {
        data: [
          {
            id: QUOTE_ITEM_ID,
            product_id: PRODUCT_ID,
            variant_id: VARIANT_ID,
            product_name: 'Acrylic Cap',
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
          order_ref: 'ORD-FULFIL-1',
          total_amount: 100,
          required_by: null,
          payment_terms: 'net20',
        },
        error: null,
      },
    },
  ]
}

function happyRpc(name: string): { data: unknown; error: { message: string } | null } {
  if (name === 'effective_unit_price') return { data: 10, error: null }
  if (name === 'submit_b2b_order') {
    return {
      data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-FULFIL-1' }],
      error: null,
    }
  }
  return { data: null, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  createDraftInvoiceForOrder.mockResolvedValue({ status: 'skipped', reason: 'disabled' })
})

describe('submitCustomerOrder — server-side fulfilment truth', () => {
  it("coerces a false 'stocked' claim on a made_to_order product: MOQ applies and rejects", async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    await expect(submitCustomerOrder(admin, buildInput())).rejects.toBeInstanceOf(
      MoqViolationError,
    )
  })

  it("honours a 'stocked' claim on a mixed product: line stays MOQ-exempt and the order commits", async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput())
    expect(result.order_id).toBe(ORDER_ID)
  })

  it("Xero gate sees drawsStock=false after coercion (made_to_order nature)", async () => {
    const { admin } = makeSupabaseStub({
      // qty meets MOQ so the order commits and reaches step 5c.
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(
      admin,
      buildInput({ qty: 24 }),
    )
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledTimes(1)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawsStock: false }),
    )
  })

  it('Xero gate still sees drawsStock=true for a genuine draw (mixed nature)', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput())
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawsStock: true }),
    )
  })

  it('catalogue-item fulfilment override beats the product base (override mixed on a made_to_order base)', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({
        productNature: 'made_to_order',
        itemNatureOverride: 'mixed',
      }),
      rpc: happyRpc,
    })

    // Line carries the exact catalogue item id → override applies → claim stands.
    const result = await submitCustomerOrder(
      admin,
      buildInput({ catalogueItemId: CAT_ITEM_ID }),
    )
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawsStock: true }),
    )
  })

  it('legacy line without a claim is untouched (still MOQ-applicable)', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    await expect(
      submitCustomerOrder(admin, buildInput({ fulfilment_type: undefined })),
    ).rejects.toBeInstanceOf(MoqViolationError)
  })

  it('sums coerced lines per product for MOQ: two 12-qty lines together meet MOQ 24', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    // Both lines falsely claim 'stocked' on a made_to_order product. After
    // coercion BOTH must count toward the production-run MOQ, and the check
    // must run against their per-product SUM (24 = MOQ), not per line (12).
    const input = buildInput({ qty: 12 })
    input.lines.push({
      ...input.lines[0],
      qty: 12,
      cart_line_id: 'line-2',
    })

    const result = await submitCustomerOrder(admin, input)
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawsStock: false }),
    )
  })
})

describe('submitCustomerOrder — order_type stamping (Foundation F-1)', () => {
  const ordersOrderTypeWrite = (
    writes: Array<{ table: string; op: string; payload: unknown }>,
  ) =>
    writes.find(
      (w) =>
        w.table === 'orders' &&
        w.op === 'update' &&
        !Array.isArray(w.payload) &&
        typeof w.payload === 'object' &&
        w.payload !== null &&
        'order_type' in (w.payload as Record<string, unknown>),
    )

  it("stamps order_type='stock_on_hand' when every line is a genuine stock draw", async () => {
    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }), // keeps the 'stocked' claim
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput()) // qty 10, stocked, MOQ-exempt
    expect(result.order_id).toBe(ORDER_ID)
    expect(ordersOrderTypeWrite(writes)?.payload).toMatchObject({
      order_type: 'stock_on_hand',
    })
  })

  it("stamps order_type='purchase_order' for a made_to_order line", async () => {
    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput({ qty: 24 }))
    expect(result.order_id).toBe(ORDER_ID)
    expect(ordersOrderTypeWrite(writes)?.payload).toMatchObject({
      order_type: 'purchase_order',
    })
  })

  it("classifies a mixed cart as 'purchase_order' (interim single-order rule)", async () => {
    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
    })

    // One stocked line (MOQ-exempt) + one made_to_order line on the same
    // (mixed) product whose 24 qty meets MOQ 24 for the production run.
    const input = buildInput({ qty: 5 })
    input.lines.push({
      ...input.lines[0],
      qty: 24,
      cart_line_id: 'line-2',
      fulfilment_type: 'made_to_order',
    })

    const result = await submitCustomerOrder(admin, input)
    expect(result.order_id).toBe(ORDER_ID)
    expect(ordersOrderTypeWrite(writes)?.payload).toMatchObject({
      order_type: 'purchase_order',
    })
  })
})
