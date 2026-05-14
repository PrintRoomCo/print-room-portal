import { describe, it, expect } from 'vitest'
import { lineSignature, type CartLineDecoration } from '../types'

describe('lineSignature', () => {
  const noDeco: CartLineDecoration[] = []

  it('matches same product + same variantId + same label + same decorations', () => {
    expect(lineSignature('p1', 'v1', 'Black / M', noDeco))
      .toBe(lineSignature('p1', 'v1', 'Black / M', noDeco))
  })

  it('differs when variantId differs', () => {
    expect(lineSignature('p1', 'v1', '—', noDeco))
      .not.toBe(lineSignature('p1', 'v2', '—', noDeco))
  })

  it('differs when label differs even if variantId matches (variantless case)', () => {
    expect(lineSignature('p1', '', 'S', noDeco))
      .not.toBe(lineSignature('p1', '', 'M', noDeco))
  })

  it('differs when decoration set differs', () => {
    const a: CartLineDecoration[] = [{ linkId: 'l1' } as CartLineDecoration]
    const b: CartLineDecoration[] = [{ linkId: 'l2' } as CartLineDecoration]
    expect(lineSignature('p1', 'v1', '—', a))
      .not.toBe(lineSignature('p1', 'v1', '—', b))
  })
})
