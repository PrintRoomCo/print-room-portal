import { describe, expect, it } from 'vitest'
import { summariseCartAdds } from '../added-toast'
import type { CartLine } from '../types'

type AddPayload = Omit<CartLine, 'lineId'>

function makeAdd(overrides: Partial<AddPayload> = {}): AddPayload {
  return {
    productId: 'p1',
    productName: 'Soft Tee',
    variantId: 'v1',
    variantLabel: 'White / M',
    sizeId: 1,
    sizeLabel: 'M',
    qty: 24,
    unitPrice: 10,
    imageUrl: 'https://img/tee.jpg',
    decorations: [],
    ...overrides,
  }
}

describe('summariseCartAdds', () => {
  it('returns null for an empty batch', () => {
    expect(summariseCartAdds([])).toBeNull()
  })

  it('summarises a single line as "qty × variant"', () => {
    expect(summariseCartAdds([makeAdd()])).toEqual({
      imageUrl: 'https://img/tee.jpg',
      title: 'Soft Tee',
      detail: '24 × White / M',
    })
  })

  it('keeps the multiplier even for a single unit', () => {
    expect(summariseCartAdds([makeAdd({ qty: 1 })])?.detail).toBe('1 × White / M')
  })

  it('merges repeat adds of the same variant into one quantity', () => {
    const summary = summariseCartAdds([
      makeAdd({ qty: 24 }),
      makeAdd({ qty: 24 }),
    ])
    expect(summary?.detail).toBe('48 × White / M')
  })

  it('summarises one product across several sizes as units · sizes', () => {
    const summary = summariseCartAdds([
      makeAdd({ variantLabel: 'White / S', sizeLabel: 'S', qty: 12 }),
      makeAdd({ variantLabel: 'White / M', sizeLabel: 'M', qty: 24 }),
      makeAdd({ variantLabel: 'White / L', sizeLabel: 'L', qty: 36 }),
    ])
    expect(summary).toMatchObject({ title: 'Soft Tee', detail: '72 units · 3 sizes' })
  })

  it('summarises several distinct products by product count', () => {
    const summary = summariseCartAdds([
      makeAdd({ productId: 'p1', productName: 'Soft Tee', qty: 24 }),
      makeAdd({ productId: 'p2', productName: 'Hoodie', qty: 12 }),
    ])
    expect(summary).toEqual({
      imageUrl: 'https://img/tee.jpg',
      title: '2 products',
      detail: '36 units',
    })
  })

  it('falls back to a unit count when the variant label is blank', () => {
    expect(summariseCartAdds([makeAdd({ variantLabel: '' })])?.detail).toBe('24 units')
  })

  it('prefers a decoration snapshot image over the line image', () => {
    const summary = summariseCartAdds([
      makeAdd({
        imageUrl: 'https://img/tee.jpg',
        decorations: [
          { snapshotUrl: 'https://img/mockup.jpg' },
        ] as unknown as CartLine['decorations'],
      }),
    ])
    expect(summary?.imageUrl).toBe('https://img/mockup.jpg')
  })
})
