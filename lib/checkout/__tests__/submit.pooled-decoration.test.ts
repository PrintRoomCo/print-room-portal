/**
 * Pooled decoration pricing on the checkout server (spec 2026-08-13, plan 2c).
 *
 * The server re-derives every price and 409s on any disagreement with the cart,
 * so these tests pin the SERVER half of the lockstep seam: which quantity reaches
 * which RPC, and what never moves.
 *
 * Two properties matter most and are asserted directly:
 *   1. FLAG-OFF PARITY — with `decoration_pooling_enabled` false, the RPC
 *      arguments are identical to the pre-pooling ones. Same fixture, both flag
 *      states, compared.
 *   2. NEVER INFLATE REAL QUANTITIES — the pooled quantity appears ONLY as an
 *      RPC qty argument. `submit_b2b_order_for_country`'s line quantities, and therefore MOQ,
 *      billed totals and order-type classification, are untouched.
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
const CAT = 'cat-1'
const DECO_PRICE = 6
const A = 'dec-A'
const B = 'dec-B'

/** Tee (500) + Hood (100) share artwork A; Cap (50) carries only B; Hood carries both. */
function world(poolingEnabled: boolean, opts: { placeholder?: boolean } = {}): StubConfig {
  const items = [
    { id: 'item-tee', sourceProductId: 'prod-tee' },
    { id: 'item-hood', sourceProductId: 'prod-hood' },
    { id: 'item-cap', sourceProductId: 'prod-cap' },
  ].map((i) => ({
    ...i,
    priceMode: 'computed' as const,
    catalogueId: CAT,
    poolingEnabled,
  }))

  const artworkId = opts.placeholder ? null : 'art-1'
  const method = opts.placeholder ? 'custom' : 'screenprint'
  const dec = (id: string) => ({
    id,
    organizationId: ORG,
    name: id,
    method,
    unitPrice: 9,
    artworkId,
  })

  return {
    items,
    // 'mixed' nature so a line claiming fulfilment_type 'stocked' survives the
    // nature coercion at submit.ts:749-761 (an unsupported claim is demoted to
    // made_to_order, and such a line is then a genuine production line).
    products: items.map((i) => ({ id: i.sourceProductId, fulfilmentType: 'mixed' })),
    links: [
      { id: 'link-tee-A', catalogueItemId: 'item-tee', sourceProductId: 'prod-tee', orgDecoration: dec(A) },
      { id: 'link-hood-A', catalogueItemId: 'item-hood', sourceProductId: 'prod-hood', orgDecoration: dec(A) },
      { id: 'link-hood-B', catalogueItemId: 'item-hood', sourceProductId: 'prod-hood', orgDecoration: dec(B) },
      { id: 'link-cap-B', catalogueItemId: 'item-cap', sourceProductId: 'prod-cap', orgDecoration: dec(B) },
    ],
    tier: null,
    // Constant price: the zero-tolerance decoration drift guard then never fires,
    // whatever quantity is used, so every assertion below is purely about WHICH
    // quantity reached the RPC — the thing pooling actually changes.
    decorationRpcPrice: () => DECO_PRICE,
    garmentUnitPrice: 12.5,
  }
}

function line(
  over: Partial<CheckoutLineInput> & { product_id: string; qty: number },
): CheckoutLineInput {
  return {
    product_name: over.product_id,
    variant_id: null,
    variant_label: null,
    fulfilment_type: 'made_to_order',
    decorations: [],
    ...over,
  } as CheckoutLineInput
}

const TEE = line({
  product_id: 'prod-tee',
  qty: 500,
  catalogueItemId: 'item-tee',
  decorations: [{ linkId: 'link-tee-A', decorationId: A, name: A, method: 'screenprint', positionLabel: null, unitPrice: DECO_PRICE, artworkUrl: null, snapshotUrl: null }],
})
const HOOD = line({
  product_id: 'prod-hood',
  qty: 100,
  catalogueItemId: 'item-hood',
  decorations: [
    { linkId: 'link-hood-A', decorationId: A, name: A, method: 'screenprint', positionLabel: null, unitPrice: DECO_PRICE, artworkUrl: null, snapshotUrl: null },
    { linkId: 'link-hood-B', decorationId: B, name: B, method: 'screenprint', positionLabel: null, unitPrice: DECO_PRICE, artworkUrl: null, snapshotUrl: null },
  ],
})
const CAP = line({
  product_id: 'prod-cap',
  qty: 50,
  catalogueItemId: 'item-cap',
  decorations: [{ linkId: 'link-cap-B', decorationId: B, name: B, method: 'screenprint', positionLabel: null, unitPrice: DECO_PRICE, artworkUrl: null, snapshotUrl: null }],
})

function checkout(lines: CheckoutLineInput[], poolLines?: CheckoutLineInput[]): CheckoutInput {
  return {
    context: makeContext(ORG),
    idempotency_key: `idem-${Math.random()}`,
    lines,
    ...(poolLines ? { pricing_pool_lines: poolLines } : {}),
  } as CheckoutInput
}

async function run(config: StubConfig, input: CheckoutInput) {
  const stub = makeFanoutStub(config)
  await submitCustomerOrder(stub.admin, input)
  const qtysFor = (rpc: string, argName: string) =>
    stub.rpcCalls.filter((c) => c.name === rpc).map((c) => c.args?.[argName] as number)
  return {
    stub,
    /** Every qty that reached the decoration price RPC, per decoration. */
    decorationQtys: (decorationId: string) =>
      stub.rpcCalls
        .filter(
          (c) =>
            c.name === 'effective_decoration_unit_price' &&
            c.args?.p_org_decoration_id === decorationId,
        )
        .map((c) => c.args?.p_qty as number)
        .filter((q, i, all) => all.indexOf(q) === i)
        .sort((a, b) => a - b),
    garmentQtys: () => qtysFor('effective_unit_price_for_item', 'p_qty').sort((a, b) => a - b),
    submittedLines: () =>
      (stub.rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines ??
        []) as Array<Record<string, unknown>>,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('flag OFF — byte-identical to pre-pooling behaviour', () => {
  it('sends every RPC the same quantities as with pooling disabled', async () => {
    const off = await run(world(false), checkout([TEE, HOOD, CAP]))
    // Own-group quantities only: no line sees another product's qty.
    expect(off.garmentQtys()).toEqual([50, 100, 500])
    expect(off.decorationQtys(A)).toEqual([100, 500])
    expect(off.decorationQtys(B)).toEqual([50, 100])
  })

  it('does not read org_decorations at all when no catalogue opts in', async () => {
    // The poolability read is the one query pooling adds; it must not exist on
    // the flag-off path, which is every catalogue at ship time.
    const off = await run(world(false), checkout([TEE, HOOD, CAP]))
    expect(off.stub.fromCount('org_decorations')).toBe(0)
  })

  it('adds no b2b_catalogue_items round trip — the flag rides the existing select', async () => {
    // The absolute count is whatever the rest of checkout already does; what
    // pooling must not do is add one. Turning the flag on changes it by zero.
    const off = await run(world(false), checkout([TEE, HOOD, CAP]))
    const on = await run(world(true), checkout([TEE, HOOD, CAP]))
    expect(on.stub.fromCount('b2b_catalogue_items')).toBe(
      off.stub.fromCount('b2b_catalogue_items'),
    )
  })
})

describe('flag ON — spec worked example B end to end', () => {
  it('prices each decoration at its OWN pool: A at 600, B at 150', async () => {
    const on = await run(world(true), checkout([TEE, HOOD, CAP]))
    expect(on.decorationQtys(A)).toEqual([600])
    expect(on.decorationQtys(B)).toEqual([150])
  })

  it('applies the max rule to the garment band, and the cap does NOT inherit 600', async () => {
    const on = await run(world(true), checkout([TEE, HOOD, CAP]))
    // Tee 600, Hood max(600,150)=600, Cap 150. Tee and Hood share a band qty but
    // are different catalogue items, so both still call the RPC.
    expect(on.garmentQtys()).toEqual([150, 600, 600])
  })

  it('keeps the round-trip invariant: one RPC per distinct (link, pooled qty)', async () => {
    // Four links, each priced once: (tee-A,600) (hood-A,600) (hood-B,150)
    // (cap-B,150). Per pair, NOT per line — and pooling collapses the qty axis
    // rather than widening it, so the budget can only shrink.
    const on = await run(world(true), checkout([TEE, HOOD, CAP]))
    expect(on.stub.rpcCount('effective_decoration_unit_price')).toBe(4)
    const off = await run(world(false), checkout([TEE, HOOD, CAP]))
    expect(off.stub.rpcCount('effective_decoration_unit_price')).toBe(4)
  })

  it('never pools the $0 custom placeholder', async () => {
    const on = await run(world(true, { placeholder: true }), checkout([TEE, HOOD, CAP]))
    expect(on.garmentQtys()).toEqual([50, 100, 500])
  })
})

describe('never inflates real quantities', () => {
  it('submits each line at its OWN qty, whatever band it priced at', async () => {
    const on = await run(world(true), checkout([TEE, HOOD, CAP]))
    const qtys = on.submittedLines().map((l) => l.quantity)
    expect(qtys).toEqual([500, 100, 50])
  })

  it('the flag changes no submitted quantity at all', async () => {
    const off = await run(world(false), checkout([TEE, HOOD, CAP]))
    const on = await run(world(true), checkout([TEE, HOOD, CAP]))
    expect(on.submittedLines().map((l) => l.quantity)).toEqual(
      off.submittedLines().map((l) => l.quantity),
    )
  })
})

describe('stocked lines (spec §5)', () => {
  it('a line whose stocked claim is DEMOTED to made_to_order does pool', async () => {
    // submit.ts coerces an unsupported 'stocked' claim to 'made_to_order' before
    // pricing. Pooling reads fulfilment_type after that coercion, which is the
    // correct order: a demoted line is a real production line and should pool.
    const madeOnlyWorld = {
      ...world(true),
      products: [
        { id: 'prod-tee', fulfilmentType: 'made_to_order' },
        { id: 'prod-hood', fulfilmentType: 'made_to_order' },
        { id: 'prod-cap', fulfilmentType: 'made_to_order' },
      ],
    }
    const claimedStockedTee = { ...TEE, fulfilment_type: 'stocked' as const }
    const on = await run(madeOnlyWorld, checkout([claimedStockedTee, HOOD]))
    expect(on.decorationQtys(A)).toEqual([600])
  })

  it('neither contribute to a pool nor receive a pooled band', async () => {
    const stockedTee = { ...TEE, fulfilment_type: 'stocked' as const }
    const on = await run(world(true), checkout([stockedTee, HOOD]))
    // A's pool is the hood's 100 alone — the stocked 500 does not contribute...
    expect(on.decorationQtys(A)).toEqual([100, 500])
    // ...and the stocked line keeps its own 500 band, receiving nothing.
    expect(on.garmentQtys()).toEqual([100, 500])
  })
})

describe('pricing_pool_lines (the F1 mixed-cart split)', () => {
  it('seeds pools from the FULL cart while submitting only this partition', async () => {
    // The route passes the whole cart as pricing_pool_lines to every partition.
    const on = await run(world(true), checkout([HOOD], [TEE, HOOD, CAP]))
    // The hood alone still earns A's full 600 pool.
    expect(on.decorationQtys(A)).toEqual([600])
    // Garment groups are seeded from the pool set (today's behaviour), so all
    // three price; what matters is that the hood's own group priced at 600.
    expect(on.garmentQtys()).toEqual([150, 600, 600])
    // ...but only the hood is submitted.
    expect(on.submittedLines().map((l) => l.quantity)).toEqual([100])
  })

  it('filters stocked lines out of the pool even though they are in the pool set', async () => {
    // pricing_pool_lines is the UNPARTITIONED cart, so stocked lines are present
    // in it on every call — the shared module's filter is load-bearing here.
    const stockedTee = { ...TEE, fulfilment_type: 'stocked' as const }
    const on = await run(world(true), checkout([HOOD], [stockedTee, HOOD, CAP]))
    expect(on.decorationQtys(A)).toEqual([100])
  })
})
