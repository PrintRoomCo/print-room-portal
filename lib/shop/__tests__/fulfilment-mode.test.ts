import { describe, it, expect } from 'vitest'
import {
  effectiveFulfilment,
  pillsFor,
  matchesMode,
  PILL_LABELS,
} from '../fulfilment-mode'

describe('effectiveFulfilment', () => {
  it('prefers the catalogue override over the master base', () => {
    expect(effectiveFulfilment('stocked', 'made_to_order')).toBe('stocked')
  })
  it('falls back to base when override is null', () => {
    expect(effectiveFulfilment(null, 'made_to_order')).toBe('made_to_order')
  })
  it('falls back to made_to_order when both missing', () => {
    expect(effectiveFulfilment(null, null)).toBe('made_to_order')
  })
})

describe('pillsFor (effective mode × role)', () => {
  it('stocked → only From inventory', () => {
    expect(pillsFor('stocked', true)).toEqual(['from_inventory'])
    expect(pillsFor('stocked', false)).toEqual(['from_inventory'])
  })
  it('made_to_order → only Reorder for admin, empty for restricted', () => {
    expect(pillsFor('made_to_order', true)).toEqual(['reorder'])
    expect(pillsFor('made_to_order', false)).toEqual([])
  })
  it('mixed → both for admin, only From inventory for restricted', () => {
    expect(pillsFor('mixed', true)).toEqual(['from_inventory', 'reorder'])
    expect(pillsFor('mixed', false)).toEqual(['from_inventory'])
  })
})

describe('matchesMode (catalogue filter)', () => {
  it('all → everything', () => {
    expect(matchesMode('stocked', 'all')).toBe(true)
    expect(matchesMode('made_to_order', 'all')).toBe(true)
  })
  it('from_inventory → stocked or mixed', () => {
    expect(matchesMode('stocked', 'from_inventory')).toBe(true)
    expect(matchesMode('mixed', 'from_inventory')).toBe(true)
    expect(matchesMode('made_to_order', 'from_inventory')).toBe(false)
  })
  it('reorder → made_to_order or mixed', () => {
    expect(matchesMode('made_to_order', 'reorder')).toBe(true)
    expect(matchesMode('mixed', 'reorder')).toBe(true)
    expect(matchesMode('stocked', 'reorder')).toBe(false)
  })
})

describe('PILL_LABELS', () => {
  it('uses the spec wording', () => {
    expect(PILL_LABELS.from_inventory).toBe('From inventory')
    expect(PILL_LABELS.reorder).toBe('Reorder')
  })
})
