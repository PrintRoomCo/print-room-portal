import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// F1 mixed-cart split: each partition is submitted in its OWN submitCustomerOrder
// call, so volume-tier pooling for a product whose qty spans both partitions
// must be restored via pricing_pool_lines (the full cart). These tests pin the
// pooled qty actually reaching the tier-price RPC.
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
vi.mock('@/lib/xero/draft-invoice', () => ({
  createDraftInvoiceForOrder: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'disabled' }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'

type AnyRow = Record<string, unknown>

function makeSupabaseStub(rpc: (name: string, args: AnyRow | undefined) => {
  data: unknown
  error: { message: string } | null
}) {
  const rpcCalls: Array<{ name: string; args: AnyRow | undefined }> = []

  function builderFor(table: string) {
    const responses: Record<string, AnyRow | AnyRow[] | null> = {
      user_organizations: { role: 'org_admin' },
      b2b_catalogue_items: [
        {
          id: CAT_ITEM_ID,
          source_product_id: PRODUCT_ID,
          moq_override: null,
          fulfilment_type_override: null,
        },
      ],
      products: [{ id: PRODUCT_ID, moq: 24, fulfilment_type: 'mixed' }],
      quote_items: [
        {
          id: 'qi-1',
          product_id: PRODUCT_ID,
          variant_id: VARIANT_ID,
          product_name: 'Acrylic Cap',
          quantity: 26,
          unit_price: 8,
          decorations: [],
          product_variants: null,
        },
      ],
      quotes: {
        id: QUOTE_ID,
        organization_id: ORG_ID,
        customer_name: 'Acme Co',
        customer_email: 'buyer@acme.test',
        order_ref: 'ORD-POOL-1',
        total_amount: 208,
        required_by: null,
        payment_terms: 'net20',
      },
    }
    const response = responses[table] ?? []
    const builder = {
      select: () => builder,
      insert: () => builder,
      update: () => builder,
      eq: () => builder,
      in: () => builder,
      is: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => ({ data: response, error: null }),
      maybeSingle: async () => ({
        data: Array.isArray(response) ? response[0] ?? null : response,
        error: null,
      }),
      then<R1>(resolve: (v: { data: unknown; error: null }) => R1): PromiseLike<R1> {
        return Promise.resolve({ data: response, error: null }).then(resolve)
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      rpcCalls.push({ name, args })
      return rpc(name, args)
    }),
    auth: {
      admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, rpcCalls }
}

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_ID = '00000000-0000-0000-0000-000000000aaa'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const ORDER_ID = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID = '00000000-0000-0000-0000-000000000222'
const VARIANT_ID = '00000000-0000-0000-0000-000000000333'

function line(over: Partial<CheckoutInput['lines'][number]> = {}): CheckoutInput['lines'][number] {
  return {
    product_id: PRODUCT_ID,
    product_name: 'Acrylic Cap',
    variant_id: VARIANT_ID,
    qty: 26,
    decorations: [],
    cart_line_id: 'line-stock',
    fulfilment_type: 'stocked',
    catalogueItemId: CAT_ITEM_ID,
    ...over,
  }
}

function buildInput(over: Partial<CheckoutInput> = {}): CheckoutInput {
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
      tenantType: null,
      allowsMultiStoreOrdering: false,
      moqExempt: false,
      orderingPermission: 'both',
    },
    idempotency_key: 'idem-pool-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    lines: [line()],
    ...over,
  }
}

const happyRpc = (name: string) => {
  if (name === 'effective_unit_price_for_item') return { data: 8, error: null }
  if (name === 'submit_b2b_order') {
    return {
      data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-POOL-1' }],
      error: null,
    }
  }
  return { data: null, error: null }
}

beforeEach(() => vi.clearAllMocks())

describe('submitCustomerOrder — pricing_pool_lines volume-tier pooling', () => {
  it('prices a partitioned line at the FULL-cart pooled qty (26 in partition, 50 in cart)', async () => {
    const { admin, rpcCalls } = makeSupabaseStub(happyRpc)

    const result = await submitCustomerOrder(
      admin,
      buildInput({
        pricing_pool_lines: [
          line(), // this partition's stocked line, qty 26
          line({ qty: 24, cart_line_id: 'line-po', fulfilment_type: 'made_to_order' }),
        ],
      }),
    )
    expect(result.order_id).toBe(ORDER_ID)

    const priceCall = rpcCalls.find((c) => c.name === 'effective_unit_price_for_item')
    expect(priceCall?.args?.p_qty).toBe(50)
  })

  it('defaults to its own lines when no pool is supplied (single-order path unchanged)', async () => {
    const { admin, rpcCalls } = makeSupabaseStub(happyRpc)

    await submitCustomerOrder(admin, buildInput())

    const priceCall = rpcCalls.find((c) => c.name === 'effective_unit_price_for_item')
    expect(priceCall?.args?.p_qty).toBe(26)
  })
})
