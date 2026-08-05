import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapQuoteItemsToStarshipitItems, loadStarshipitOrderItems } from '../items'

describe('mapQuoteItemsToStarshipitItems', () => {
  it('builds "name — size — colour" descriptions with quantity and value', () => {
    const items = mapQuoteItemsToStarshipitItems([
      {
        product_name: 'Classic Tee',
        quantity: 5,
        unit_price: 24.5,
        size_label: 'L',
        product_variants: { product_color_swatches: { label: 'Black' } },
      },
    ])
    expect(items).toEqual([
      { description: 'Classic Tee — L — Black', quantity: 5, value: 24.5 },
    ])
  })

  it('tolerates array-shaped PostgREST embeds', () => {
    const items = mapQuoteItemsToStarshipitItems([
      {
        product_name: 'Cap',
        quantity: 2,
        unit_price: 12,
        size_label: null,
        product_variants: [{ product_color_swatches: [{ label: 'Red' }] }],
      },
    ])
    expect(items[0].description).toBe('Cap — Red')
  })

  it('falls back to "Item", quantity 1, and no value on sparse rows', () => {
    const items = mapQuoteItemsToStarshipitItems([
      { product_name: null, quantity: null, unit_price: null, size_label: null, product_variants: null },
    ])
    expect(items).toEqual([{ description: 'Item', quantity: 1 }])
  })
})

describe('loadStarshipitOrderItems', () => {
  function makeAdmin(result: { data: unknown; error: { message: string } | null }) {
    const eq = vi.fn().mockResolvedValue(result)
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    return { admin: { from } as unknown as SupabaseClient, from, select, eq }
  }

  it('queries quote_items by quote_id and maps the rows', async () => {
    const { admin, from, eq } = makeAdmin({
      data: [{ product_name: 'Hoodie', quantity: 3, unit_price: 55, size_label: 'M', product_variants: null }],
      error: null,
    })
    const items = await loadStarshipitOrderItems(admin, 'q1')
    expect(from).toHaveBeenCalledWith('quote_items')
    expect(eq).toHaveBeenCalledWith('quote_id', 'q1')
    expect(items).toEqual([{ description: 'Hoodie — M', quantity: 3, value: 55 }])
  })

  it('returns [] on a query error (best-effort — an address-only ticket still prints)', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'boom' } })
    await expect(loadStarshipitOrderItems(admin, 'q1')).resolves.toEqual([])
  })
})
