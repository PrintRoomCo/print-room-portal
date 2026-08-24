/**
 * Characterization tests for the checkout drift/reprice semantics.
 *
 * Written BEFORE the fan-out refactor (perf/checkout-fanout) to pin current
 * behaviour: same errors, same drift-entry content and ORDER, same fallback
 * ladders. These must stay green, unchanged, through fixes A1–A3. They assert
 * outcomes only — never how many queries were made (that's the round-trip
 * regression test's job).
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
  DecorationDriftError,
  submitCustomerOrder,
  type CheckoutInput,
  type CheckoutLineInput,
  type CheckoutLineDecorationInput,
} from '../submit'
import { makeFanoutStub, makeContext, type StubConfig } from './fanout-test-stub'

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const PRODUCT_M = 'prod-manual'
const PRODUCT_C = 'prod-computed'
const ITEM_M = 'item-manual'
const ITEM_C = 'item-computed'

/** Two-item world: one manual_final item, one computed item. */
function baseConfig(): StubConfig {
  return {
    items: [
      { id: ITEM_M, sourceProductId: PRODUCT_M, priceMode: 'manual_final' },
      { id: ITEM_C, sourceProductId: PRODUCT_C, priceMode: 'computed' },
    ],
    products: [{ id: PRODUCT_M }, { id: PRODUCT_C }],
    links: [
      // manual item placements
      { id: 'link-m1', catalogueItemId: ITEM_M, sourceProductId: PRODUCT_M, orgDecoration: { id: 'dec-m1', organizationId: ORG, name: 'Front print', unitPrice: 14 } },
      { id: 'link-m2', catalogueItemId: ITEM_M, sourceProductId: PRODUCT_M, orgDecoration: { id: 'dec-m2', organizationId: ORG, name: 'Back print', unitPrice: 14 } },
      // computed item placements
      { id: 'link-c1', catalogueItemId: ITEM_C, sourceProductId: PRODUCT_C, orgDecoration: { id: 'dec-c1', organizationId: ORG, name: 'Left chest', unitPrice: 14 } },
      { id: 'link-c2', catalogueItemId: ITEM_C, sourceProductId: PRODUCT_C, unitPriceOverride: 3.5, orgDecoration: { id: 'dec-c2', organizationId: ORG, name: 'Sleeve', unitPrice: 14 } },
      // structural-failure fixtures on the computed product
      { id: 'link-cross', catalogueItemId: ITEM_C, sourceProductId: PRODUCT_C, orgDecoration: { id: 'dec-x', organizationId: OTHER_ORG, name: 'Cross org', unitPrice: 9 } },
      { id: 'link-inactive', catalogueItemId: ITEM_C, sourceProductId: PRODUCT_C, orgDecoration: { id: 'dec-i', organizationId: ORG, name: 'Inactive', unitPrice: 8, isActive: false } },
      { id: 'link-wrong', catalogueItemId: ITEM_C, sourceProductId: 'prod-other', orgDecoration: { id: 'dec-w', organizationId: ORG, name: 'Wrong item', unitPrice: 7 } },
    ],
    tier: null,
    decorationRpcPrice: (odId) => (odId === 'dec-c1' ? 5 : null),
    manualCombinedPrice: () => 7.5,
    garmentUnitPrice: 12.5,
  }
}

function dec(linkId: string, decorationId: string, name: string, unitPrice: number): CheckoutLineDecorationInput {
  return { linkId, decorationId, name, method: 'screenprint', positionLabel: null, unitPrice, artworkUrl: null, snapshotUrl: null }
}

function line(overrides: Partial<CheckoutLineInput>): CheckoutLineInput {
  return {
    product_id: PRODUCT_C,
    product_name: 'Computed Tee',
    variant_id: null,
    qty: 10,
    ship_to_store_id: null,
    decorations: [],
    cart_line_id: 'line-1',
    catalogueItemId: ITEM_C,
    ...overrides,
  }
}

function buildInput(lines: CheckoutLineInput[]): CheckoutInput {
  return {
    context: makeContext(ORG) as CheckoutInput['context'],
    idempotency_key: 'idem-char-1',
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

describe('computed path — pricing resolution ladder', () => {
  it('prices from the RPC when it returns a value, folds decorations into unit_price', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    // dec-c1 → RPC 5.00; dec-c2 → RPC null → link override 3.5. No tier row → ×1.
    await submitCustomerOrder(
      admin,
      buildInput([
        line({ decorations: [dec('link-c1', 'dec-c1', 'Left chest', 5), dec('link-c2', 'dec-c2', 'Sleeve', 3.5)] }),
      ]),
    )
    const submitCall = rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')
    expect(submitCall?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 5 + 3.5, catalogue_item_id: ITEM_C }),
    ])
  })

  it('falls back to org_decorations.unit_price when RPC returns null and no link override', async () => {
    const cfg = baseConfig()
    cfg.decorationRpcPrice = () => null
    const { admin, rpcCalls } = makeFanoutStub(cfg)
    // link-c1 has no override → base 14
    await submitCustomerOrder(
      admin,
      buildInput([line({ decorations: [dec('link-c1', 'dec-c1', 'Left chest', 14)] })]),
    )
    const submitCall = rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')
    expect(submitCall?.args?.p_lines).toEqual([expect.objectContaining({ unit_price: 12.5 + 14 })])
  })

  it('applies the pricing-tier multiplier to the resolved base (2dp rounding)', async () => {
    const cfg = baseConfig()
    cfg.tier = { multiplier: 0.9 }
    const { admin, rpcCalls } = makeFanoutStub(cfg)
    // dec-c1 RPC 5.00 × 0.9 = 4.5
    await submitCustomerOrder(
      admin,
      buildInput([line({ decorations: [dec('link-c1', 'dec-c1', 'Left chest', 4.5)] })]),
    )
    expect(rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 4.5 }),
    ])
  })

  it('prefers tier_discount_override over the tier multiplier', async () => {
    const cfg = baseConfig()
    cfg.tier = { tierDiscountOverride: 0.8, multiplier: 0.9 }
    const { admin, rpcCalls } = makeFanoutStub(cfg)
    await submitCustomerOrder(
      admin,
      buildInput([line({ decorations: [dec('link-c1', 'dec-c1', 'Left chest', 4)] })]),
    )
    expect(rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 4 }),
    ])
  })

  it('prices embroidery through the stitch-ladder RPC × tier, same path as screenprint', async () => {
    const cfg = baseConfig()
    // Stitch-ladder cutover (2026-07-17): embroidery resolves via
    // effective_decoration_unit_price (whose embroidery branch is the
    // stitch-count ladder, qty-independent) with the tier multiplier applied —
    // identical resolution to screenprint. The PDP fetches the same RPC × tier
    // via /api/shop/decoration-pricing, so the cart claim matches exactly.
    cfg.tier = { multiplier: 0.85 }
    cfg.links.push({
      id: 'link-emb',
      catalogueItemId: ITEM_C,
      sourceProductId: PRODUCT_C,
      orgDecoration: {
        id: 'dec-emb',
        organizationId: ORG,
        name: 'Front embroidery',
        method: 'embroidery',
        unitPrice: 14, // stale static snapshot — must NOT be billed
      },
    })
    // 7k-stitch band on the apparel ladder → $8.00; × 0.85 tier = $6.80.
    cfg.decorationRpcPrice = (odId) => (odId === 'dec-emb' ? 8 : null)
    const { admin, rpcCalls } = makeFanoutStub(cfg)
    await submitCustomerOrder(
      admin,
      buildInput([
        line({
          decorations: [
            {
              linkId: 'link-emb',
              decorationId: 'dec-emb',
              name: 'Front embroidery',
              method: 'embroidery',
              positionLabel: null,
              unitPrice: 6.8,
              artworkUrl: null,
              snapshotUrl: null,
            },
          ],
        }),
      ]),
    )
    expect(rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 6.8 }),
    ])
    // The stitch ladder IS consulted for embroidery now.
    expect(
      rpcCalls.filter(
        (c) =>
          c.name === 'effective_decoration_unit_price' && c.args?.p_org_decoration_id === 'dec-emb',
      ).length,
    ).toBeGreaterThan(0)
  })

  it('blocks a stale static embroidery claim with price_drift (pre-cutover cart lines)', async () => {
    const cfg = baseConfig()
    cfg.tier = { multiplier: 0.85 }
    cfg.links.push({
      id: 'link-emb',
      catalogueItemId: ITEM_C,
      sourceProductId: PRODUCT_C,
      orgDecoration: {
        id: 'dec-emb',
        organizationId: ORG,
        name: 'Front embroidery',
        method: 'embroidery',
        unitPrice: 14,
      },
    })
    cfg.decorationRpcPrice = (odId) => (odId === 'dec-emb' ? 8 : null)
    const { admin } = makeFanoutStub(cfg)
    // A cart line added before the cutover still claims the raw static $14 —
    // the zero-tolerance guard must block it (customer re-adds at the real price).
    const err = await submitCustomerOrder(
      admin,
      buildInput([
        line({
          decorations: [
            {
              linkId: 'link-emb',
              decorationId: 'dec-emb',
              name: 'Front embroidery',
              method: 'embroidery',
              positionLabel: null,
              unitPrice: 14,
              artworkUrl: null,
              snapshotUrl: null,
            },
          ],
        }),
      ]),
    ).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(DecorationDriftError)
    expect((err as DecorationDriftError).drift).toEqual([
      expect.objectContaining({ linkId: 'link-emb', was: 14, now: 6.8, reason: 'price_drift' }),
    ])
  })

  it('pools decoration qty across lines sharing product + decoration signature', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    await submitCustomerOrder(
      admin,
      buildInput([
        line({ qty: 10, cart_line_id: 'l1', decorations: [dec('link-c1', 'dec-c1', 'Left chest', 5)] }),
        line({ qty: 15, cart_line_id: 'l2', decorations: [dec('link-c1', 'dec-c1', 'Left chest', 5)] }),
      ]),
    )
    const priced = rpcCalls.filter((c) => c.name === 'effective_decoration_unit_price')
    expect(priced.length).toBeGreaterThan(0)
    for (const c of priced) expect(c.args?.p_qty).toBe(25)
  })

  it('prices a legacy line (no catalogueItemId) through the computed path', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    await submitCustomerOrder(
      admin,
      buildInput([
        line({ catalogueItemId: undefined, decorations: [dec('link-c1', 'dec-c1', 'Left chest', 5)] }),
      ]),
    )
    expect(rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 5, catalogue_item_id: null }),
    ])
  })
})

describe('computed path — drift and structural rejections', () => {
  it('throws price_drift when the claimed decoration price mismatches, with was/now', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    const err = await submitCustomerOrder(
      admin,
      buildInput([line({ decorations: [dec('link-c1', 'dec-c1', 'Left chest', 4.5)] })]),
    ).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(DecorationDriftError)
    expect((err as DecorationDriftError).drift).toEqual([
      {
        cartLineId: 'line-1',
        productId: PRODUCT_C,
        linkId: 'link-c1',
        decorationName: 'Left chest',
        was: 4.5,
        now: 5,
        reason: 'price_drift',
      },
    ])
    expect(rpcCalls.filter((c) => c.name === 'submit_b2b_order_for_country')).toHaveLength(0)
  })

  it('reports structural failures in decoration order: detached, cross_org, inactive, wrong_item', async () => {
    const { admin } = makeFanoutStub(baseConfig())
    const err = await submitCustomerOrder(
      admin,
      buildInput([
        line({
          decorations: [
            dec('link-ghost', 'dec-g', 'Ghost', 5),
            dec('link-cross', 'dec-x', 'Cross org', 9),
            dec('link-inactive', 'dec-i', 'Inactive', 8),
            dec('link-wrong', 'dec-w', 'Wrong item', 7),
          ],
        }),
      ]),
    ).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(DecorationDriftError)
    const drift = (err as DecorationDriftError).drift
    expect(drift.map((d) => d.reason)).toEqual(['detached', 'cross_org', 'inactive', 'wrong_item'])
    expect(drift[0]).toMatchObject({ linkId: 'link-ghost', decorationName: 'Ghost', was: 5, now: 0 })
    expect(drift[1]).toMatchObject({ linkId: 'link-cross', decorationName: 'Cross org', now: 9 })
    expect(drift[2]).toMatchObject({ linkId: 'link-inactive', decorationName: 'Inactive', now: 8 })
    expect(drift[3]).toMatchObject({ linkId: 'link-wrong', decorationName: 'Wrong item', now: 7 })
  })

  it('an unpublished link is treated as detached', async () => {
    const cfg = baseConfig()
    cfg.links.push({
      id: 'link-unpub',
      catalogueItemId: ITEM_C,
      sourceProductId: PRODUCT_C,
      isPublished: false,
      orgDecoration: { id: 'dec-u', organizationId: ORG, name: 'Unpublished', unitPrice: 6 },
    })
    const { admin } = makeFanoutStub(cfg)
    const err = await submitCustomerOrder(
      admin,
      buildInput([line({ decorations: [dec('link-unpub', 'dec-u', 'Unpublished', 6)] })]),
    ).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(DecorationDriftError)
    expect((err as DecorationDriftError).drift[0]).toMatchObject({ reason: 'detached', now: 0 })
  })

  it('propagates a link-select failure as "decoration lookup failed"', async () => {
    const cfg = baseConfig()
    cfg.selectErrorFor = { b2b_catalogue_item_decorations: 'boom' }
    const { admin } = makeFanoutStub(cfg)
    await expect(
      submitCustomerOrder(
        admin,
        buildInput([line({ decorations: [dec('link-c1', 'dec-c1', 'Left chest', 5)] })]),
      ),
    ).rejects.toThrow('decoration lookup failed: boom')
  })
})

describe('manual_final path', () => {
  const manualLine = (overrides: Partial<CheckoutLineInput> = {}) =>
    line({
      product_id: PRODUCT_M,
      product_name: 'Manual Tee',
      catalogueItemId: ITEM_M,
      decorations: [dec('link-m1', 'dec-m1', 'Front print', 14), dec('link-m2', 'dec-m2', 'Back print', 14)],
      ...overrides,
    })

  it('bills the ONE combined figure; placements are kept as $0 metadata; no per-placement pricing', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    await submitCustomerOrder(admin, buildInput([manualLine({ claimed_manual_decoration: 7.5 })]))
    // combined figure billed once at line level, on top of the garment price
    expect(rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 7.5 }),
    ])
    // the per-placement engine was never consulted for a manual line
    expect(rpcCalls.filter((c) => c.name === 'effective_decoration_unit_price')).toHaveLength(0)
  })

  it('re-prices silently when the claim is null/absent (legacy carts)', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    await submitCustomerOrder(admin, buildInput([manualLine({ claimed_manual_decoration: null })]))
    expect(rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 7.5 }),
    ])
  })

  it('blocks with zero tolerance when the claimed combined figure drifts', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    const err = await submitCustomerOrder(
      admin,
      buildInput([manualLine({ claimed_manual_decoration: 7.49 })]),
    ).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(DecorationDriftError)
    expect((err as DecorationDriftError).drift).toEqual([
      expect.objectContaining({
        decorationName: 'Decoration (combined)',
        linkId: 'link-m1', // first validated placement carries the drift pointer
        was: 7.49,
        now: 7.5,
        reason: 'price_drift',
      }),
    ])
    expect(rpcCalls.filter((c) => c.name === 'submit_b2b_order_for_country')).toHaveLength(0)
  })

  it('bills the combined figure for a manual line with NO decorations at all', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    await submitCustomerOrder(
      admin,
      buildInput([manualLine({ decorations: [], claimed_manual_decoration: 7.5 })]),
    )
    expect(rpcCalls.find((c) => c.name === 'submit_b2b_order_for_country')?.args?.p_lines).toEqual([
      expect.objectContaining({ unit_price: 12.5 + 7.5 }),
    ])
  })

  it('uses the pooled decoration qty for the combined-figure lookup', async () => {
    const { admin, rpcCalls } = makeFanoutStub(baseConfig())
    await submitCustomerOrder(
      admin,
      buildInput([
        manualLine({ qty: 10, cart_line_id: 'l1', claimed_manual_decoration: 7.5 }),
        manualLine({ qty: 15, cart_line_id: 'l2', claimed_manual_decoration: 7.5 }),
      ]),
    )
    const combined = rpcCalls.filter((c) => c.name === 'catalogue_item_decoration_price')
    expect(combined.length).toBeGreaterThan(0)
    for (const c of combined) expect(c.args).toEqual({ p_catalogue_item_id: ITEM_M, p_qty: 25 })
  })
})

describe('mixed orders — drift entries preserve line order', () => {
  it('collects drift from a manual line then a computed line, in input order, before throwing once', async () => {
    const { admin } = makeFanoutStub(baseConfig())
    const err = await submitCustomerOrder(
      admin,
      buildInput([
        line({
          product_id: PRODUCT_M,
          product_name: 'Manual Tee',
          catalogueItemId: ITEM_M,
          cart_line_id: 'manual-line',
          decorations: [dec('link-m1', 'dec-m1', 'Front print', 14)],
          claimed_manual_decoration: 1, // drifts (server 7.5)
        }),
        line({
          cart_line_id: 'computed-line',
          decorations: [dec('link-c1', 'dec-c1', 'Left chest', 4.99)], // drifts (server 5)
        }),
      ]),
    ).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(DecorationDriftError)
    const drift = (err as DecorationDriftError).drift
    expect(drift.map((d) => d.cartLineId)).toEqual(['manual-line', 'computed-line'])
    expect(drift[0]).toMatchObject({ decorationName: 'Decoration (combined)', was: 1, now: 7.5 })
    expect(drift[1]).toMatchObject({ linkId: 'link-c1', was: 4.99, now: 5 })
  })
})
