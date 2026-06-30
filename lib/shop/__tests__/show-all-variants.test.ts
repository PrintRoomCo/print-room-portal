import { describe, it, expect } from 'vitest'
import {
  SHOW_ALL_VARIANTS_KEY,
  readShowAllVariants,
  writeShowAllVariants,
} from '../show-all-variants'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  }
}

describe('show-all-variants', () => {
  it('defaults to ON when nothing is stored', () => {
    expect(readShowAllVariants(fakeStorage())).toBe(true)
  })

  it('reads a stored OFF', () => {
    expect(readShowAllVariants(fakeStorage({ [SHOW_ALL_VARIANTS_KEY]: '0' }))).toBe(false)
  })

  it('reads a stored ON', () => {
    expect(readShowAllVariants(fakeStorage({ [SHOW_ALL_VARIANTS_KEY]: '1' }))).toBe(true)
  })

  it('round-trips through write', () => {
    const s = fakeStorage()
    writeShowAllVariants(s, false)
    expect(readShowAllVariants(s)).toBe(false)
    writeShowAllVariants(s, true)
    expect(readShowAllVariants(s)).toBe(true)
  })
})
