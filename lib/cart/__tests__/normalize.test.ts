import { describe, it, expect } from 'vitest'
import { normalizePersisted } from '../normalize'
import { recomputeProductTierPrices } from '../types'

describe('normalizePersisted — catalogue identity round-trip (phase 2)', () => {
  it('preserves catalogueItemId through localStorage shape', () => {
    const payload = {
      lines: [
        {
          lineId: 'l1',
          productId: 'p1',
          qty: 5,
          unitPrice: 10,
          catalogueItemId: 'ci-1',
        },
      ],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines).toHaveLength(1)
    expect(lines[0].catalogueItemId).toBe('ci-1')
  })

  it('defaults catalogueItemId to null for legacy lines that lack it', () => {
    const payload = {
      lines: [{ lineId: 'l1', productId: 'p1', qty: 5, unitPrice: 10 }],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines[0].catalogueItemId).toBeNull()
  })

  it('coerces non-string catalogue fields to null (defensive)', () => {
    const payload = {
      lines: [
        {
          lineId: 'l1',
          productId: 'p1',
          qty: 5,
          unitPrice: 10,
          catalogueItemId: 123,
        },
      ],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines[0].catalogueItemId).toBeNull()
  })
})

describe('normalizePersisted — nature round-trip (Spec B / F1)', () => {
  it("preserves a 'mixed' nature so the cart order-type selector survives reload", () => {
    const payload = {
      lines: [
        { lineId: 'l1', productId: 'p1', qty: 5, unitPrice: 10, nature: 'mixed' },
      ],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines[0].nature).toBe('mixed')
  })

  it('preserves the homogeneous natures and drops garbage values', () => {
    const payload = {
      lines: [
        { lineId: 'l1', productId: 'p1', qty: 1, unitPrice: 1, nature: 'stocked' },
        { lineId: 'l2', productId: 'p2', qty: 1, unitPrice: 1, nature: 'made_to_order' },
        { lineId: 'l3', productId: 'p3', qty: 1, unitPrice: 1, nature: 'evil' },
        { lineId: 'l4', productId: 'p4', qty: 1, unitPrice: 1 },
      ],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines[0].nature).toBe('stocked')
    expect(lines[1].nature).toBe('made_to_order')
    expect(lines[2].nature).toBeUndefined()
    expect(lines[3].nature).toBeUndefined()
  })
})

describe('normalizePersisted — billingMode round-trip (Spec 3a)', () => {
  it('preserves the per-variant billing snapshot so the Pre-paid badge survives reload', () => {
    const payload = {
      lines: [
        { lineId: 'l1', productId: 'p1', qty: 1, unitPrice: 1, billingMode: 'prepaid' },
        { lineId: 'l2', productId: 'p2', qty: 1, unitPrice: 1, billingMode: 'invoice_on_dispatch' },
        { lineId: 'l3', productId: 'p3', qty: 1, unitPrice: 1, billingMode: 'evil' },
        { lineId: 'l4', productId: 'p4', qty: 1, unitPrice: 1 },
      ],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines[0].billingMode).toBe('prepaid')
    expect(lines[1].billingMode).toBe('invoice_on_dispatch')
    expect(lines[2].billingMode).toBeUndefined()
    expect(lines[3].billingMode).toBeUndefined()
  })
})

describe('normalizePersisted — canonical price currency', () => {
  it('preserves valid uppercase ISO currency and leaves legacy lines absent', () => {
    const { lines } = normalizePersisted({
      lines: [
        { lineId: 'aud', productId: 'p1', qty: 1, unitPrice: 10, priceCurrency: 'AUD' },
        { lineId: 'legacy', productId: 'p2', qty: 1, unitPrice: 10 },
      ],
    })
    expect(lines[0].priceCurrency).toBe('AUD')
    expect(lines[1].priceCurrency).toBeUndefined()
  })

  it.each(['aud', 'AU', 'AUDD', 123])('drops invalid persisted currency %j', (priceCurrency) => {
    const { lines } = normalizePersisted({
      lines: [{ lineId: 'bad', productId: 'p1', qty: 1, unitPrice: 10, priceCurrency }],
    })
    expect(lines[0].priceCurrency).toBeUndefined()
  })
})

describe('normalizePersisted — decoration rendition provenance', () => {
  it('preserves the exact production rendition through localStorage', () => {
    const { lines } = normalizePersisted({
      lines: [
        {
          lineId: 'navy',
          productId: 'hood',
          qty: 10,
          unitPrice: 40,
          decorations: [
            {
              linkId: 'link-navy',
              decorationId: 'logo-left-chest',
              name: 'Screen print — Left Chest',
              method: 'screenprint',
              unitPrice: 5,
              renditionId: 'white-ink',
              renditionLabel: 'White ink',
            },
          ],
        },
      ],
    })

    expect(lines[0].decorations[0]).toMatchObject({
      renditionId: 'white-ink',
      renditionLabel: 'White ink',
    })
  })
})

/**
 * Pooled decoration pricing must survive the localStorage round-trip.
 *
 * `normalizePersisted` is an ALLOW-LIST: it rebuilds every line field by field,
 * so anything it does not name is silently dropped on reload. The pooling
 * identity (`catalogueId`, `poolingEnabled`, and `poolable` per decoration) and
 * the manual_final combined decoration snapshot were never added to it. All four
 * are ADD-TIME SNAPSHOTS the cart cannot re-derive — the PDP resolves them from
 * the catalogue and the org decoration library — so once dropped, that line could
 * never pool again no matter how much more the customer added.
 *
 * Symptom: "Same artwork savings" and the next-band nudge show when you add to
 * cart, then vanish the moment you reload or navigate to the cart page.
 *
 * `pooledQty` is the deliberate exception: it is DERIVED from the other lines in
 * the cart, so persisting it would let a stale pool size outlive the cart that
 * produced it. It is recomputed on hydrate instead — which is exactly what the
 * last test here pins.
 */
describe('normalizePersisted — pooled decoration pricing round-trip', () => {
  const decoration = {
    linkId: 'link-1',
    decorationId: 'dec-1',
    name: 'Screen print — Left Chest',
    method: 'screenprint',
    positionLabel: 'Left Chest',
    unitPrice: 0,
    artworkUrl: null,
    snapshotUrl: null,
    poolable: true,
  }
  const pooledLine = {
    lineId: 'l-1',
    productId: 'p1',
    productName: 'Demo Store Tee',
    variantId: 'v1',
    variantLabel: 'Navy / S',
    qty: 126,
    unitPrice: 30,
    imageUrl: null,
    fulfilmentType: 'made_to_order',
    catalogueItemId: 'ci-1',
    catalogueId: 'cat-1',
    poolingEnabled: true,
    manualDecorationPerUnit: 4,
    manualDecorationBrackets: [
      { minQty: 1, maxQty: 99, unitPrice: 6.5 },
      { minQty: 100, maxQty: null, unitPrice: 4 },
    ],
    decorations: [decoration],
  }
  const siblingLine = {
    ...pooledLine,
    lineId: 'l-2',
    productId: 'p2',
    productName: 'Everyday Pullover Hoodie',
    catalogueItemId: 'ci-2',
    qty: 116,
  }

  it('keeps the line-level pooling identity', () => {
    const [line] = normalizePersisted({ lines: [pooledLine] }).lines
    expect(line.catalogueId).toBe('cat-1')
    expect(line.poolingEnabled).toBe(true)
  })

  it('keeps the manual_final combined decoration snapshot and its ladder', () => {
    const [line] = normalizePersisted({ lines: [pooledLine] }).lines
    expect(line.manualDecorationPerUnit).toBe(4)
    expect(line.manualDecorationBrackets).toEqual([
      { minQty: 1, maxQty: 99, unitPrice: 6.5 },
      { minQty: 100, maxQty: null, unitPrice: 4 },
    ])
  })

  it('keeps poolable — a server decision the client cannot re-derive', () => {
    const [line] = normalizePersisted({ lines: [pooledLine] }).lines
    expect(line.decorations[0].poolable).toBe(true)
  })

  it('restores a working pool end-to-end: reload then recompute re-pools', () => {
    const { lines } = normalizePersisted({ lines: [pooledLine, siblingLine] })
    // Derived, so not persisted...
    expect(lines[0].decorations[0].pooledQty).toBeUndefined()
    // ...but the hydrate path rebuilds it from the restored identity.
    const [tee, hoodie] = recomputeProductTierPrices(lines)
    expect(tee.decorations[0].pooledQty).toBe(242)
    expect(hoodie.decorations[0].pooledQty).toBe(242)
  })

  it('leaves a legacy line untouched — absent stays not-pooling', () => {
    const [line] = normalizePersisted({
      lines: [
        {
          ...pooledLine,
          catalogueId: undefined,
          poolingEnabled: undefined,
          manualDecorationPerUnit: undefined,
          manualDecorationBrackets: undefined,
          decorations: [{ ...decoration, poolable: undefined }],
        },
      ],
    }).lines
    expect(line.catalogueId).toBeNull()
    expect(line.poolingEnabled).toBe(false)
    expect(line.manualDecorationPerUnit ?? null).toBeNull()
    expect(line.manualDecorationBrackets).toBeUndefined()
    expect(line.decorations[0].poolable).toBe(false)
  })
})
