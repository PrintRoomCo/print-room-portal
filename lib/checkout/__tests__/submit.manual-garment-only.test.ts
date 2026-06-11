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

vi.mock('@/lib/orders/job-tracker', () => ({
  createJobTrackerShellForOrder: vi
    .fn()
    .mockResolvedValue({ trackerId: 't-test', trackerToken: 'TOKEN-X' }),
}))

import {
  DecorationDriftError,
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
const CAT_ITEM_ID = '00000000-0000-0000-0000-0000000000aa'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000bbb'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'
const ORDER_ID = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID = '00000000-0000-0000-0000-000000000222'
const QUOTE_ITEM_ID = 'qi-1'

function makeSupabaseStub(opts: {
  manualDecoration: number | null
  garmentUnit?: number
}) {
  const rpcCalls: RpcCallRecord[] = []

  const catalogueRows = [
    {
      id: CAT_ITEM_ID,
      source_product_id: PRODUCT_ID,
      moq_override: null,
      price_mode: 'manual_final',
    },
  ]
  const quoteItemRows = [
    {
      id: QUOTE_ITEM_ID,
      product_id: PRODUCT_ID,
      variant_id: null,
      product_name: 'Manual Tee',
      quantity: 10,
      unit_price: opts.garmentUnit ?? 12.5,
      decorations: [],
      product_variants: null,
    },
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
    if (table === 'quote_items') {
      return { data: quoteItemRows, error: null }
    }
    if (table === 'quotes') {
      return {
        data: {
          id: QUOTE_ID,
          organization_id: ORG_ID,
          customer_name: 'Acme Co',
          customer_email: 'buyer@acme.test',
          order_ref: 'ORD-TEST-1',
          total_amount: 125,
          required_by: null,
          payment_terms: 'net20',
        },
        error: null,
      }
    }
    return { data: [], error: null }
  }

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const settle = (): SelectResponse => {
      if (pendingWrite) return { data: null, error: null }
      return responseFor(table)
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
      is: (_column: string, _value: unknown) => builder,
      gt: (_column: string, _value: unknown) => builder,
      order: (_column: string, _opts?: unknown) => builder,
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
        return Promise.resolve(settle()).then(resolve, reject)
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      rpcCalls.push({ name, args })
      if (name === 'effective_unit_price_for_item') {
        return { data: opts.garmentUnit ?? 12.5, error: null }
      }
      if (name === 'catalogue_item_decoration_price') {
        return { data: opts.manualDecoration, error: null }
      }
      if (name === 'submit_b2b_order') {
        return {
          data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }],
          error: null,
        }
      }
      return { data: null, error: null }
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
    product_name: 'Manual Tee',
    variant_id: null,
    qty: 10,
    ship_to_store_id: null,
    decorations: [],
    cart_line_id: 'line-1',
    claimed_unit_price: 12.5,
    has_brackets: true,
    fulfilment_type: 'stocked',
    catalogueItemId: CAT_ITEM_ID,
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
    custom_shipping_address: null,
    lines,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MONDAY_REORDERS_BOARD_ID = '2046357917'
})

describe('submitCustomerOrder manual_final garment-only pricing', () => {
  it('bills the item combined decoration figure when a manual_final line has no selected decorations', async () => {
    const { admin, rpcCalls } = makeSupabaseStub({ manualDecoration: 7.5 })

    await submitCustomerOrder(
      admin,
      buildInput([line({ claimed_manual_decoration: 7.5 })]),
    )

    expect(rpcCalls).toContainEqual({
      name: 'catalogue_item_decoration_price',
      args: { p_catalogue_item_id: CAT_ITEM_ID, p_qty: 10 },
    })
    const submitCall = rpcCalls.find((c) => c.name === 'submit_b2b_order')
    expect(submitCall?.args?.p_lines).toEqual([
      {
        product_id: PRODUCT_ID,
        product_name: 'Manual Tee',
        quantity: 10,
        unit_price: 20,
        variant_id: null,
        catalogue_item_id: CAT_ITEM_ID,
      },
    ])
  })

  it.each([0, null])(
    'bills zero decoration for a plain manual_final line when the combined RPC returns %s',
    async (manualDecoration) => {
      const { admin, rpcCalls } = makeSupabaseStub({ manualDecoration })

      await submitCustomerOrder(
        admin,
        buildInput([line({ claimed_manual_decoration: manualDecoration })]),
      )

      const submitCall = rpcCalls.find((c) => c.name === 'submit_b2b_order')
      expect(submitCall?.args?.p_lines).toEqual([
        expect.objectContaining({
          unit_price: 12.5,
          catalogue_item_id: CAT_ITEM_ID,
        }),
      ])
    },
  )

  it('blocks a garment-only manual_final line when the claimed combined decoration drifts', async () => {
    const { admin, rpcCalls } = makeSupabaseStub({ manualDecoration: 7.5 })

    await expect(
      submitCustomerOrder(
        admin,
        buildInput([line({ claimed_manual_decoration: 2 })]),
      ),
    ).rejects.toBeInstanceOf(DecorationDriftError)

    expect(rpcCalls.filter((c) => c.name === 'submit_b2b_order')).toHaveLength(0)
  })
})
