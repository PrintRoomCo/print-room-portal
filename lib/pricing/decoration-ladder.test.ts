import { describe, expect, it } from 'vitest'
import { pickBracket } from '@/lib/cart/types'
import {
  ladderPriceAt,
  normalizeLadderBrackets,
  type DecorationLadderRow,
} from './decoration-ladder'

const row = (min: number, max: number | null, price: number): DecorationLadderRow => ({
  min_quantity: min,
  max_quantity: max,
  unit_price: price,
})

/** Every ladder shape the staff editor allows, plus the ones it doesn't but the DB tolerates. */
const LADDERS: Record<string, DecorationLadderRow[]> = {
  'contiguous with open tail': [row(1, 23, 9), row(24, 99, 7), row(100, null, 5)],
  'contiguous, closed top band': [row(1, 10, 9), row(11, 20, 7)],
  'gapped': [row(1, 10, 9), row(50, null, 3)],
  'starts above 1': [row(5, 10, 9), row(11, null, 6)],
  'gapped and starts above 1': [row(5, 10, 9), row(60, 80, 4)],
  'single open band': [row(1, null, 4.5)],
  'single closed band': [row(12, 20, 4.5)],
  'unsorted input': [row(100, null, 5), row(1, 23, 9), row(24, 99, 7)],
}

const QUANTITIES = [1, 2, 4, 5, 9, 10, 11, 12, 20, 21, 23, 24, 49, 50, 59, 60, 80, 81, 99, 100, 101, 600, 10_000]

describe('normalizeLadderBrackets is equivalent to the database lookup', () => {
  for (const [label, ladder] of Object.entries(LADDERS)) {
    it(`matches ladderPriceAt at every quantity — ${label}`, () => {
      const brackets = normalizeLadderBrackets(ladder)
      expect(brackets).not.toBeNull()
      for (const qty of QUANTITIES) {
        expect(pickBracket(brackets!, qty)?.unitPrice).toBe(ladderPriceAt(ladder, qty))
      }
    })
  }

  it('always yields gapless brackets covering [1, ∞)', () => {
    for (const ladder of Object.values(LADDERS)) {
      const brackets = normalizeLadderBrackets(ladder)!
      expect(brackets[0].minQty).toBe(1)
      expect(brackets.at(-1)!.maxQty).toBeNull()
      for (let i = 0; i < brackets.length - 1; i++) {
        expect(brackets[i].maxQty).toBe(brackets[i + 1].minQty - 1)
      }
    }
  })

  it('preserves band prices in ascending-quantity order', () => {
    expect(normalizeLadderBrackets(LADDERS['unsorted input'])).toEqual([
      { minQty: 1, maxQty: 23, unitPrice: 9 },
      { minQty: 24, maxQty: 99, unitPrice: 7 },
      { minQty: 100, maxQty: null, unitPrice: 5 },
    ])
  })

  it('returns null for an absent or empty ladder, so callers keep engine/flat pricing', () => {
    expect(normalizeLadderBrackets(null)).toBeNull()
    expect(normalizeLadderBrackets(undefined)).toBeNull()
    expect(normalizeLadderBrackets([])).toBeNull()
  })

  it('accepts numeric strings, as PostgREST returns numeric columns', () => {
    const brackets = normalizeLadderBrackets([
      { min_quantity: 1, max_quantity: 23, unit_price: '9.50' },
      { min_quantity: 24, max_quantity: null, unit_price: '7.25' },
    ])
    expect(brackets).toEqual([
      { minQty: 1, maxQty: 23, unitPrice: 9.5 },
      { minQty: 24, maxQty: null, unitPrice: 7.25 },
    ])
  })
})

describe('ladderPriceAt — the three clamp steps', () => {
  it('picks the exact band covering the qty', () => {
    expect(ladderPriceAt(LADDERS['contiguous with open tail'], 50)).toBe(7)
  })

  it('clamps UP: above a closed top band, uses the highest band at or below', () => {
    expect(ladderPriceAt(LADDERS['contiguous, closed top band'], 500)).toBe(7)
  })

  it('clamps DOWN: below the first band, uses the lowest band', () => {
    expect(ladderPriceAt(LADDERS['starts above 1'], 1)).toBe(9)
    expect(ladderPriceAt(LADDERS['single closed band'], 3)).toBe(4.5)
  })

  it('inside a gap, uses the band below — not the band above', () => {
    expect(ladderPriceAt(LADDERS['gapped'], 25)).toBe(9)
  })

  it('returns null with no ladder', () => {
    expect(ladderPriceAt([], 10)).toBeNull()
    expect(ladderPriceAt(null, 10)).toBeNull()
  })
})
