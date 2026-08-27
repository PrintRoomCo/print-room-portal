/**
 * The submit backstop. The single property that matters: when the gate blocks,
 * `submit_b2b_order_for_country` is NEVER called. Everything else about the
 * order is irrelevant if a sub-minimum order can reach the database.
 */
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
vi.mock('@/lib/monday/updates', () => ({
  postItemUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/xero/draft-invoice', () => ({
  createDraftInvoiceForOrder: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'test' }),
}))

import {
  MinimumOrderValueError,
  submitCustomerOrder,
  type CheckoutInput,
} from '../submit'
import { makeFanoutStub, makeContext, type StubConfig } from './fanout-test-stub'

const ORG = 'org-1'
const CAT = 'cat-1'
const ITEM = 'item-tee'
const PRODUCT = 'prod-tee'

/** One made-to-order tee line. Unit price and qty are the test's only lever. */
function world(garmentUnitPrice: number): StubConfig {
  return {
    items: [
      {
        id: ITEM,
        sourceProductId: PRODUCT,
        priceMode: 'computed' as const,
        catalogueId: CAT,
      },
    ],
    products: [{ id: PRODUCT }],
    links: [],
    garmentUnitPrice,
  }
}

function input(
  qty: number,
  overrides: { minOrderExempt?: boolean; intent?: 'customer' | 'inventory' } = {},
): CheckoutInput {
  return {
    context: {
      ...makeContext(ORG),
      minOrderExempt: overrides.minOrderExempt ?? false,
    },
    idempotency_key: `idem-${qty}-${overrides.intent ?? 'customer'}`,
    ...(overrides.intent ? { intent: overrides.intent } : {}),
    lines: [
      {
        product_id: PRODUCT,
        product_name: 'Tee',
        variant_id: 'var-1',
        qty,
        unit_price: 10,
        catalogueItemId: ITEM,
        fulfilment_type: 'made_to_order',
        decorations: [],
      },
    ],
  } as unknown as CheckoutInput
}

let stub: ReturnType<typeof makeFanoutStub>

function submitRpcCalls() {
  return stub.rpcCalls.filter((call) => call.name === 'submit_b2b_order_for_country')
}

describe('submitCustomerOrder minimum order value', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws before the order RPC when a purchase order is under the minimum', async () => {
    stub = makeFanoutStub(world(10))
    // 30 x $10 = $300 notional, under $500.
    await expect(submitCustomerOrder(stub.admin, input(30))).rejects.toBeInstanceOf(
      MinimumOrderValueError,
    )
    expect(submitRpcCalls()).toHaveLength(0)
  })

  it('carries the status and a customer-ready message on the error', async () => {
    stub = makeFanoutStub(world(10))
    const error = await submitCustomerOrder(stub.admin, input(30)).catch((e) => e)
    expect(error).toBeInstanceOf(MinimumOrderValueError)
    expect(error.code).toBe('minimum_order_value')
    expect(error.status.threshold).toBe(500)
    expect(error.status.value).toBe(300)
    expect(error.status.shortfall).toBe(200)
    expect(error.message).toContain('$500 minimum')
    expect(error.message).toContain('talk to us about smaller runs')
  })

  it('lets an order at the minimum through to the RPC', async () => {
    stub = makeFanoutStub(world(10))
    // 50 x $10 = $500 exactly.
    await submitCustomerOrder(stub.admin, input(50))
    expect(submitRpcCalls()).toHaveLength(1)
  })

  it('lets an exempt org through under the minimum', async () => {
    stub = makeFanoutStub(world(10))
    await submitCustomerOrder(stub.admin, input(30, { minOrderExempt: true }))
    expect(submitRpcCalls()).toHaveLength(1)
  })

  it('lets an inventory-intent order through under the minimum', async () => {
    stub = makeFanoutStub(world(10))
    await submitCustomerOrder(stub.admin, input(30, { intent: 'inventory' }))
    expect(submitRpcCalls()).toHaveLength(1)
  })
})
