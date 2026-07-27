import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'mky-1', subitemIds: {} }),
}))

vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))

import {
  UnitPriceDriftError,
  submitCustomerOrder,
  type CheckoutInput,
  type CheckoutLineInput,
} from '../submit'

type AnyRow = Record<string, unknown>

interface RpcCallRecord {
  name: string
  args: AnyRow | undefined
}

interface SelectResponse {
  data: AnyRow | AnyRow[] | null
  error: { message: string } | null
}

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_A = '00000000-0000-0000-0000-0000000000aa'
const CAT_ITEM_B = '00000000-0000-0000-0000-0000000000bb'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000bbb'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'

function makeSupabaseStub(opts: {
  rpc: (name: string, args: AnyRow | undefined) => {
    data: unknown
    error: { message: string } | null
  }
}) {
  const rpcCalls: RpcCallRecord[] = []
  const catalogueRows = [
    { id: CAT_ITEM_A, source_product_id: PRODUCT_ID, moq_override: null },
    { id: CAT_ITEM_B, source_product_id: PRODUCT_ID, moq_override: null },
  ]

  function responseFor(table: string): SelectResponse {
    if (table === 'user_organizations') {
      return { data: { role: 'org_admin' }, error: null }
    }
    if (table === 'b2b_catalogue_items') {
      return { data: catalogueRows, error: null }
    }
    if (table === 'products') {
      return { data: [{ id: PRODUCT_ID, moq: 1 }], error: null }
    }
    return { data: [], error: null }
  }

  function builderFor(table: string) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gt: () => builder,
      single: async () => responseFor(table),
      maybeSingle: async () => {
        const r = responseFor(table)
        if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error }
        return r
      },
      then<R1 = SelectResponse, R2 = never>(
        resolve: (v: SelectResponse) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        try {
          return Promise.resolve(responseFor(table)).then(resolve, reject)
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
      rpcCalls.push({ name, args })
      return opts.rpc(name, args)
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, rpcCalls }
}

function line(overrides: Partial<CheckoutLineInput> = {}): CheckoutLineInput {
  return {
    product_id: PRODUCT_ID,
    product_name: 'Basic Tee',
    variant_id: null,
    qty: 10,
    ship_to_store_id: null,
    decorations: [],
    cart_line_id: 'line-1',
    claimed_unit_price: 10,
    has_brackets: true,
    fulfilment_type: 'stocked',
    ...overrides,
  }
}

function buildInput(lines: CheckoutLineInput[]): CheckoutInput {
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
    idempotency_key: 'idem-test-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    custom_shipping_address: null,
    lines,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('submitCustomerOrder item-aware repricing', () => {
  it('uses effective_unit_price_for_item when a line carries catalogueItemId', async () => {
    const { admin, rpcCalls } = makeSupabaseStub({
      rpc: (name) => {
        if (name === 'effective_unit_price_for_item') return { data: 22, error: null }
        if (name === 'effective_unit_price') return { data: 99, error: null }
        return { data: null, error: null }
      },
    })

    await expect(
      submitCustomerOrder(admin, buildInput([line({ catalogueItemId: CAT_ITEM_A })])),
    ).rejects.toBeInstanceOf(UnitPriceDriftError)

    expect(rpcCalls.filter((c) => c.name === 'effective_unit_price')).toHaveLength(0)
    expect(rpcCalls.filter((c) => c.name === 'effective_unit_price_for_item')).toEqual([
      {
        name: 'effective_unit_price_for_item',
        args: {
          p_catalogue_item_id: CAT_ITEM_A,
          p_org_id: ORG_ID,
          p_qty: 10,
        },
      },
    ])
  })

  it('keeps using effective_unit_price when a line has no catalogueItemId', async () => {
    const { admin, rpcCalls } = makeSupabaseStub({
      rpc: (name) => {
        if (name === 'effective_unit_price') return { data: 22, error: null }
        if (name === 'effective_unit_price_for_item') return { data: 99, error: null }
        return { data: null, error: null }
      },
    })

    await expect(submitCustomerOrder(admin, buildInput([line()]))).rejects.toBeInstanceOf(
      UnitPriceDriftError,
    )

    expect(rpcCalls.filter((c) => c.name === 'effective_unit_price_for_item')).toHaveLength(0)
    expect(rpcCalls.filter((c) => c.name === 'effective_unit_price')).toEqual([
      {
        name: 'effective_unit_price',
        args: {
          p_product_id: PRODUCT_ID,
          p_org_id: ORG_ID,
          p_qty: 10,
        },
      },
    ])
  })

  it('does not share a product-level price bucket across different catalogue items', async () => {
    const { admin, rpcCalls } = makeSupabaseStub({
      rpc: (name) => {
        if (name === 'effective_unit_price_for_item') return { data: 22, error: null }
        if (name === 'effective_unit_price') return { data: 99, error: null }
        return { data: null, error: null }
      },
    })

    await expect(
      submitCustomerOrder(
        admin,
        buildInput([
          line({ cart_line_id: 'line-1', catalogueItemId: CAT_ITEM_A, qty: 4 }),
          line({ cart_line_id: 'line-2', catalogueItemId: CAT_ITEM_B, qty: 6 }),
        ]),
      ),
    ).rejects.toBeInstanceOf(UnitPriceDriftError)

    expect(rpcCalls.filter((c) => c.name === 'effective_unit_price')).toHaveLength(0)
    expect(rpcCalls.filter((c) => c.name === 'effective_unit_price_for_item')).toEqual([
      {
        name: 'effective_unit_price_for_item',
        args: {
          p_catalogue_item_id: CAT_ITEM_A,
          p_org_id: ORG_ID,
          p_qty: 4,
        },
      },
      {
        name: 'effective_unit_price_for_item',
        args: {
          p_catalogue_item_id: CAT_ITEM_B,
          p_org_id: ORG_ID,
          p_qty: 6,
        },
      },
    ])
  })
})
