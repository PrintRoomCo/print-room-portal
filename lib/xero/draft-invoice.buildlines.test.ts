import { describe, it, expect } from 'vitest'
import { buildDraftLines } from './draft-invoice'

const row = (over: Partial<Parameters<typeof buildDraftLines>[0][number]> = {}) => ({
  product_name: 'Tee', quantity: 100, unit_price: 10, size_label: 'M',
  decorations: null, product_variants: null,
  product_id: 'p1', variant_id: 'v1', size_id: 1, qty_from_stock: 0,
  ...over,
})
const key = 'p1::v1::1'

describe('buildDraftLines', () => {
  it('leaves a non-prepaid line charged in full', () => {
    const lines = buildDraftLines([row({ qty_from_stock: 100 })], new Set())
    expect(lines).toHaveLength(1)
    expect(lines[0].unitAmount).toBe(10)
    expect(lines[0].quantity).toBe(100)
  })

  it('zeroes a prepaid stock-draw line in full, as a single tagged line', () => {
    const lines = buildDraftLines([row({ qty_from_stock: 100 })], new Set([key]))
    expect(lines).toHaveLength(1)
    expect(lines[0].unitAmount).toBe(0)
    expect(lines[0].quantity).toBe(100)
    expect(lines[0].description).toMatch(/prepaid stock — drawn down, no charge/)
  })

  it('charges a prepaid variant that drew NO stock (its line is a made-to-order PO)', () => {
    const lines = buildDraftLines([row({ quantity: 100, qty_from_stock: 0 })], new Set([key]))
    expect(lines).toHaveLength(1)
    expect(lines[0].unitAmount).toBe(10)
    expect(lines[0].quantity).toBe(100)
  })

  it('zeroes the WHOLE line even if qty_from_stock < quantity — invariant guard, no split', () => {
    // Documentary: the ordering layer never produces a partial prepaid draw
    // (short orders become MOQ purchase orders — spec §Domain rules). If one
    // ever reached billing, the qty_from_stock>0 gate zeroes the whole line;
    // there is deliberately NO split into a $0 drawn + charged made line.
    const lines = buildDraftLines([row({ quantity: 100, qty_from_stock: 60 })], new Set([key]))
    expect(lines).toHaveLength(1)
    expect(lines[0].unitAmount).toBe(0)
    expect(lines[0].quantity).toBe(100)
  })
})
