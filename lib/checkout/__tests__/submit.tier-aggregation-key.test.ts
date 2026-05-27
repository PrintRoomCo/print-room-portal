import { describe, it, expect } from 'vitest'
import { tierAggregationKey, type CheckoutLineDecorationInput } from '../submit'

/**
 * The drift-guard side of `submitCustomerOrder` must group lines by the same
 * key the cart uses in `recomputeProductTierPrices` — otherwise the canonical
 * unit price re-derived server-side won't match what the cart displayed and
 * `UnitPriceDriftError` will false-positive on legitimate split-line orders.
 *
 * These tests mirror the cart-side coverage in lib/cart/__tests__/types.test.ts
 * so divergence between the two surfaces shows up as a test diff, not a
 * production drift error.
 */
describe('tierAggregationKey', () => {
  const deco = (linkId: string): CheckoutLineDecorationInput => ({
    linkId,
    decorationId: `od:${linkId}`,
    name: `deco-${linkId}`,
    method: 'screenprint',
    positionLabel: 'LC',
    unitPrice: 5,
    artworkUrl: 'https://example/art.png',
    snapshotUrl: null,
  })

  it('garment-only lines (empty decorations) share the same key', () => {
    expect(tierAggregationKey('p1', [])).toBe(tierAggregationKey('p1', []))
    expect(tierAggregationKey('p1', undefined)).toBe(tierAggregationKey('p1', []))
  })

  it('same product + same single decoration set: same key', () => {
    expect(tierAggregationKey('p1', [deco('l1')]))
      .toBe(tierAggregationKey('p1', [deco('l1')]))
  })

  it('same product + same multi-decoration set in different order: same key (sorted)', () => {
    expect(tierAggregationKey('p1', [deco('a'), deco('b')]))
      .toBe(tierAggregationKey('p1', [deco('b'), deco('a')]))
  })

  it('same product + subset vs superset decoration sets: different keys', () => {
    expect(tierAggregationKey('p1', [deco('a'), deco('b')]))
      .not.toBe(tierAggregationKey('p1', [deco('a')]))
  })

  it('same product + different single decoration: different keys', () => {
    expect(tierAggregationKey('p1', [deco('l1')]))
      .not.toBe(tierAggregationKey('p1', [deco('l2')]))
  })

  it('different products + identical decoration set: different keys', () => {
    expect(tierAggregationKey('p1', [deco('l1')]))
      .not.toBe(tierAggregationKey('p2', [deco('l1')]))
  })

  it('garment-only vs decorated line of same product: different keys', () => {
    expect(tierAggregationKey('p1', []))
      .not.toBe(tierAggregationKey('p1', [deco('l1')]))
  })
})
