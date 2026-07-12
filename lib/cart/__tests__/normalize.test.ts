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
