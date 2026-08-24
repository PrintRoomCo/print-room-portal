import { describe, it, expect } from 'vitest'
import { normalizePersisted } from '../normalize'

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
