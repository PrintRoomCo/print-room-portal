import { describe, it, expect } from 'vitest'
import { normalizePersisted } from '../normalize'

describe('normalizePersisted — catalogue identity round-trip (phase 2)', () => {
  it('preserves catalogueItemId + catalogueVariantLabel through localStorage shape', () => {
    const payload = {
      lines: [
        {
          lineId: 'l1',
          productId: 'p1',
          qty: 5,
          unitPrice: 10,
          catalogueItemId: 'ci-1',
          catalogueVariantLabel: 'Design A',
        },
      ],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines).toHaveLength(1)
    expect(lines[0].catalogueItemId).toBe('ci-1')
    expect(lines[0].catalogueVariantLabel).toBe('Design A')
  })

  it('defaults both fields to null for legacy lines that lack them', () => {
    const payload = {
      lines: [{ lineId: 'l1', productId: 'p1', qty: 5, unitPrice: 10 }],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines[0].catalogueItemId).toBeNull()
    expect(lines[0].catalogueVariantLabel).toBeNull()
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
          catalogueVariantLabel: { junk: true },
        },
      ],
    }
    const { lines } = normalizePersisted(payload)
    expect(lines[0].catalogueItemId).toBeNull()
    expect(lines[0].catalogueVariantLabel).toBeNull()
  })
})
