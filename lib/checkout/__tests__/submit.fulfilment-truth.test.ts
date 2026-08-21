import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (hoisted) — same shape as submit.pre-approved-inventory.test.ts, plus
// the Xero orchestrator so we can assert the picking fee it receives (0 for a
// coerced purchase order, >0 for a genuine stock-on-hand draw).
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

// Spec 3a: billing is per VARIANT (variant_inventory.billing_mode), resolved
// through this module — mock it so no test touches a DB. Default: every
// variant pays at checkout; override per-test with mockResolvedValue.
const { resolveLineBillingModes } = vi.hoisted(() => ({
  resolveLineBillingModes: vi.fn(
    async () => new Map<string, 'invoice_on_dispatch' | 'prepaid'>(),
  ),
}))
vi.mock('@/lib/checkout/resolve-line-billing-modes', () => ({
  resolveLineBillingModes,
  buildBillingModeMap: (rows: Array<{ variant_id: string; billing_mode: string | null }>) =>
    new Map(
      rows.map((r) => [r.variant_id, r.billing_mode === 'prepaid' ? 'prepaid' : 'invoice_on_dispatch']),
    ),
}))

import {
  submitCustomerOrder,
  MoqViolationError,
  type CheckoutInput,
} from '../submit'
import { postItemUpdate } from '@/lib/monday/updates'

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
  writeErrors?: Partial<Record<string, { message: string }>>
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
        return { data: null, error: opts.writeErrors?.[table] ?? null }
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
      branchStoreIds: [],
      tenantType: null,
      allowsMultiStoreOrdering: false,
      moqExempt: false, // MOQ ENFORCED — this suite tests the MOQ × fulfilment interaction
      orderingPermission: 'both',
    },
    idempotency_key: 'idem-fulfilment-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    custom_shipping_address: { country: 'NZ' },
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
    // SP1: the one-time-address guard reads the org's enabled countries. These
    // fixtures are NZ orgs, so NZ must be enabled or every submit is rejected.
    { table: 'organization_countries', response: { data: [{ country_code: 'NZ' }], error: null } },
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

function happyCatalogueItemRpc(name: string): {
  data: unknown
  error: { message: string } | null
} {
  if (name === 'effective_unit_price_for_item') return { data: 10, error: null }
  return happyRpc(name)
}

beforeEach(() => {
  vi.clearAllMocks()
  createDraftInvoiceForOrder.mockResolvedValue({ status: 'skipped', reason: 'disabled' })
  resolveLineBillingModes.mockResolvedValue(
    new Map<string, 'invoice_on_dispatch' | 'prepaid'>(),
  )
})

// Xero draft + Monday billing note now run in Next's after(); flush the
// deferred work (run immediately by the vitest.setup mock) before asserting.
const flushAfter = () =>
  (globalThis as unknown as { flushAfter: () => Promise<void> }).flushAfter()

describe('submitCustomerOrder — Xero location contact wiring', () => {
  const STORE_ID = '00000000-0000-0000-0000-000000000444'

  it('passes the ship-to store id through to the Xero draft', async () => {
    const { admin } = makeSupabaseStub({
      selects: [
        {
          table: 'stores',
          response: {
            data: {
              id: STORE_ID,
              name: 'Reburger Takapuna',
              address: '6 Te Rauroha Street, Papakura',
              city: 'Auckland',
              state: null,
              country: 'NZ',
              postal_code: '2110',
            },
            error: null,
          },
        },
        ...baseSelects({ productNature: 'mixed' }),
      ],
      rpc: happyRpc,
    })

    const input = {
      ...buildInput({ ship_to_store_id: STORE_ID }),
      custom_shipping_address: null,
    }
    const result = await submitCustomerOrder(admin, input)
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    expect(vi.mocked(createDraftInvoiceForOrder).mock.calls[0][1].shipToStoreId).toBe(STORE_ID)
  })

  it('passes a null store id for a one-time custom-address order', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput())
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    expect(vi.mocked(createDraftInvoiceForOrder).mock.calls[0][1].shipToStoreId).toBeNull()
  })
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
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
  })

  it('coerced made_to_order line → purchase order → no picking fee', async () => {
    const { admin, rpcCalls } = makeSupabaseStub({
      // qty meets MOQ so the order commits and reaches step 5c.
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(
      admin,
      buildInput({ qty: 24 }),
    )
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledTimes(1)
    // claim coerced away → purchase order → no picking fee (was drawsStock=false).
    expect(vi.mocked(createDraftInvoiceForOrder).mock.calls[0][1].pickingFee).toBe(0)

    const submitCall = rpcCalls.find((c) => c.name === 'submit_b2b_order')
    const lines = submitCall?.args?.p_lines as Array<{ fulfilment_route: string | null }>
    // A stocked claim on a made_to_order item is coerced, and the coerced value
    // is what travels — the route is derived after coercion, not before.
    expect(lines[0].fulfilment_route).toBe('purchase_order')
  })

  it('genuine stock draw (mixed nature) → stock-on-hand order → picking fee applies', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput())
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    // 'stocked' claim stands → all-stocked order → picking fee applies (was drawsStock=true).
    expect(vi.mocked(createDraftInvoiceForOrder).mock.calls[0][1].pickingFee).toBeGreaterThan(0)
  })

  it('posts the prepaid billing note to Monday when every stocked line is prepaid', async () => {
    // Spec 3a: prepaid is the VARIANT's class now, not the catalogue item's.
    resolveLineBillingModes.mockResolvedValue(
      new Map<string, 'invoice_on_dispatch' | 'prepaid'>([[VARIANT_ID, 'prepaid']]),
    )
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyCatalogueItemRpc,
    })

    await submitCustomerOrder(
      admin,
      buildInput({ catalogueItemId: CAT_ITEM_ID }),
    )
    await flushAfter()

    expect(postItemUpdate).toHaveBeenCalledWith(
      'mky-1',
      'Prepaid — no Xero invoice required (pick fee $30.00 only).',
    )
  })

  it('posts the not-paid billing note to Monday when a stocked line needs invoicing', async () => {
    resolveLineBillingModes.mockResolvedValue(
      new Map<string, 'invoice_on_dispatch' | 'prepaid'>([[VARIANT_ID, 'invoice_on_dispatch']]),
    )
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyCatalogueItemRpc,
    })

    await submitCustomerOrder(
      admin,
      buildInput({ catalogueItemId: CAT_ITEM_ID }),
    )
    await flushAfter()

    expect(postItemUpdate).toHaveBeenCalledWith(
      'mky-1',
      'Not paid — draft quote raised, invoice before dispatch. Pick fee $30.00.',
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
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    // 'stocked' claim stands → all-stocked order → picking fee applies (was drawsStock=true).
    expect(vi.mocked(createDraftInvoiceForOrder).mock.calls[0][1].pickingFee).toBeGreaterThan(0)
  })

  it('picking-fee band uses the DECO-INCLUSIVE goods subtotal (matches the checkout estimate)', async () => {
    // Garment-only: $9 × 10 = $90 → 0-99 band → $35. Deco-inclusive:
    // $90 + ($1.50 × 10) = $105 → 100-199 band → $30. The customer-facing
    // estimate (CheckoutReviewClient) prices from allInUnitPrice (garment +
    // decoration), so the server MUST band on the same figure.
    const selects = baseSelects({ productNature: 'mixed' }).map((m) =>
      m.table === 'b2b_catalogue_items'
        ? {
            table: m.table,
            response: {
              data: [
                {
                  id: CAT_ITEM_ID,
                  source_product_id: PRODUCT_ID,
                  moq_override: null,
                  fulfilment_type_override: null,
                  price_mode: 'manual_final', // decoration billed as ONE combined figure
                },
              ],
              error: null,
            },
          }
        : m,
    )
    const { admin, rpcCalls } = makeSupabaseStub({
      selects,
      rpc: (name) => {
        // Lines with a catalogueItemId price via the item-scoped RPC.
        if (name === 'effective_unit_price_for_item') return { data: 9, error: null }
        if (name === 'catalogue_item_decoration_price') return { data: 1.5, error: null }
        return happyRpc(name)
      },
    })

    const result = await submitCustomerOrder(
      admin,
      buildInput({ catalogueItemId: CAT_ITEM_ID }),
    )
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    expect(rpcCalls.map((c) => c.name)).toContain('catalogue_item_decoration_price')
    expect(vi.mocked(createDraftInvoiceForOrder).mock.calls[0][1].pickingFee).toBe(30)
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
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)
    // claim coerced away → purchase order → no picking fee (was drawsStock=false).
    expect(vi.mocked(createDraftInvoiceForOrder).mock.calls[0][1].pickingFee).toBe(0)
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

  it('audits and still completes the order when the order_type stamp cannot be persisted', async () => {
    const { admin, writes } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
      writeErrors: { orders: { message: 'order_type write failed' } },
    })

    // The order row is already committed by the RPC, so a failed stamp must not
    // 500 the customer or orphan the order — it records an audit breadcrumb and
    // continues (the order stays 'purchase_order' until re-stamped).
    const result = await submitCustomerOrder(admin, buildInput())
    await flushAfter()
    expect(result.order_id).toBe(ORDER_ID)

    const stampFailureAudit = writes.find(
      (w) =>
        w.table === 'audit_events' &&
        !Array.isArray(w.payload) &&
        typeof w.payload === 'object' &&
        w.payload !== null &&
        (w.payload as Record<string, unknown>).action === 'order.order_type_stamp_failed',
    )
    expect(stampFailureAudit).toBeTruthy()
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
