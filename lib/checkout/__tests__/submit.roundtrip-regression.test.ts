/**
 * Round-trip regression guard for the checkout fan-out fix (perf/checkout-fanout).
 *
 * Pins the query budget of submitCustomerOrder's validation/pricing phase so the
 * O(lines) sequential PostgREST fan-out can't silently return:
 *   - decoration-link lookups: ONE batched select, independent of line count
 *   - manual combined-price RPC: one call per distinct (catalogue item, pooled qty)
 *   - computed decoration-price RPC: one call per distinct (link, pooled qty)
 *   - tier-multiplier lookup (b2b_accounts): at most one per checkout
 *
 * Written RED against the per-line loop; goes green with fixes A1–A3.
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

import { submitCustomerOrder, type CheckoutInput, type CheckoutLineInput } from '../submit'
import { makeFanoutStub, makeContext, type StubConfig } from './fanout-test-stub'

const ORG = 'org-1'

/** N-line uniform order over `itemCount` manual items, 3 decorations per line. */
function manualWorld(itemCount: number): StubConfig {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`,
    sourceProductId: `prod-${i}`,
    priceMode: 'manual_final' as const,
  }))
  return {
    items,
    products: items.map((i) => ({ id: i.sourceProductId })),
    links: items.flatMap((item, i) =>
      [0, 1, 2].map((j) => ({
        id: `link-${i}-${j}`,
        catalogueItemId: item.id,
        sourceProductId: item.sourceProductId,
        orgDecoration: { id: `dec-${i}-${j}`, organizationId: ORG, name: `Placement ${j}`, unitPrice: 14 },
      })),
    ),
    tier: null,
    manualCombinedPrice: () => 7.5,
    garmentUnitPrice: 12.5,
  }
}

function computedWorld(): StubConfig {
  return {
    items: [{ id: 'item-c', sourceProductId: 'prod-c', priceMode: 'computed' }],
    products: [{ id: 'prod-c' }],
    links: [0, 1].map((j) => ({
      id: `link-${j}`,
      catalogueItemId: 'item-c',
      sourceProductId: 'prod-c',
      orgDecoration: { id: `dec-${j}`, organizationId: ORG, name: `Placement ${j}`, unitPrice: 14 },
    })),
    tier: { multiplier: 1 },
    decorationRpcPrice: () => 5,
    garmentUnitPrice: 12.5,
  }
}

function manualLines(n: number, itemCount: number): CheckoutLineInput[] {
  return Array.from({ length: n }, (_, i) => {
    const item = i % itemCount
    return {
      product_id: `prod-${item}`,
      product_name: `Product ${item}`,
      variant_id: null,
      qty: 10,
      ship_to_store_id: null,
      cart_line_id: `l-${i}`,
      catalogueItemId: `item-${item}`,
      claimed_manual_decoration: 7.5,
      decorations: [0, 1, 2].map((j) => ({
        linkId: `link-${item}-${j}`,
        decorationId: `dec-${item}-${j}`,
        name: `Placement ${j}`,
        method: 'screenprint',
        positionLabel: null,
        unitPrice: 14,
        artworkUrl: null,
        snapshotUrl: null,
      })),
    }
  })
}

function computedLines(n: number): CheckoutLineInput[] {
  return Array.from({ length: n }, (_, i) => ({
    product_id: 'prod-c',
    product_name: 'Computed Tee',
    variant_id: null,
    qty: 10,
    ship_to_store_id: null,
    cart_line_id: `l-${i}`,
    catalogueItemId: 'item-c',
    decorations: [0, 1].map((j) => ({
      linkId: `link-${j}`,
      decorationId: `dec-${j}`,
      name: `Placement ${j}`,
      method: 'screenprint',
      positionLabel: null,
      unitPrice: 5,
      artworkUrl: null,
      snapshotUrl: null,
    })),
  }))
}

function buildInput(lines: CheckoutLineInput[]): CheckoutInput {
  return {
    context: makeContext(ORG) as CheckoutInput['context'],
    idempotency_key: 'idem-rt-1',
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

describe('round-trip budget — manual_final path', () => {
  it('fetches all decoration links in ONE batched select regardless of line count', async () => {
    const { admin, fromCount } = makeFanoutStub(manualWorld(3))
    await submitCustomerOrder(admin, buildInput(manualLines(12, 3)))
    expect(fromCount('b2b_catalogue_item_decorations')).toBe(1)
  })

  it('calls the combined-price RPC once per distinct (item, pooled qty), not per line', async () => {
    const { admin, rpcCount } = makeFanoutStub(manualWorld(3))
    // 12 lines over 3 items, all pooling to one qty per item → 3 distinct pairs
    await submitCustomerOrder(admin, buildInput(manualLines(12, 3)))
    expect(rpcCount('catalogue_item_decoration_price')).toBe(3)
  })

  it('holds the same query budget at N=3 and N=24 (N-independence)', async () => {
    const small = makeFanoutStub(manualWorld(3))
    await submitCustomerOrder(small.admin, buildInput(manualLines(3, 3)))
    const large = makeFanoutStub(manualWorld(3))
    await submitCustomerOrder(large.admin, buildInput(manualLines(24, 3)))

    expect(large.fromCount('b2b_catalogue_item_decorations')).toBe(
      small.fromCount('b2b_catalogue_item_decorations'),
    )
    expect(large.rpcCount('catalogue_item_decoration_price')).toBe(
      small.rpcCount('catalogue_item_decoration_price'),
    )
  })
})

describe('round-trip budget — computed path', () => {
  it('looks up the tier multiplier at most once per checkout', async () => {
    const { admin, fromCount } = makeFanoutStub(computedWorld())
    // 6 lines × 2 decorations = 12 effectiveDecorationPrice resolutions today
    await submitCustomerOrder(admin, buildInput(computedLines(6)))
    expect(fromCount('b2b_accounts')).toBeLessThanOrEqual(1)
  })

  it('calls the decoration-price RPC once per distinct (link, pooled qty), not per line×decoration', async () => {
    const { admin, rpcCount } = makeFanoutStub(computedWorld())
    // 6 lines share one product+signature pool → 2 distinct links at one pooled qty
    await submitCustomerOrder(admin, buildInput(computedLines(6)))
    expect(rpcCount('effective_decoration_unit_price')).toBe(2)
  })
})
