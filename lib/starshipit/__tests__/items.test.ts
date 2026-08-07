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

// Table-aware admin: quote_items via .select().eq(); products via .select().in().
function makeTableAdmin(opts: {
  quoteItems?: unknown
  quoteItemsError?: { message: string } | null
  products?: unknown
  productsError?: { message: string } | null
}) {
  const inSpy = vi
    .fn()
    .mockResolvedValue({ data: opts.products ?? [], error: opts.productsError ?? null })
  const eqSpy = vi
    .fn()
    .mockResolvedValue({ data: opts.quoteItems ?? null, error: opts.quoteItemsError ?? null })
  const from = vi.fn((table: string) => {
    if (table === 'products') return { select: vi.fn(() => ({ in: inSpy })) }
    return { select: vi.fn(() => ({ eq: eqSpy })) }
  })
  return { admin: { from } as unknown as SupabaseClient, from, inSpy, eqSpy }
}

describe('loadStarshipitOrderItems — products.sku enrichment', () => {
  it('attaches products.sku to lines by source_product_id, blank when absent', async () => {
    const { admin, inSpy } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 2, unit_price: 20, size_label: 'L', source_product_id: 'p1', product_variants: null },
        { product_name: 'Bottle', quantity: 1, unit_price: 8, size_label: null, source_product_id: 'p2', product_variants: null },
      ],
      products: [{ id: 'p1', sku: 'TEE-001' }], // p2 has no products.sku row
    })
    const items = await loadStarshipitOrderItems(admin, 'q1')
    expect(items[0]).toEqual({ description: 'Tee — L', quantity: 2, value: 20, sku: 'TEE-001' })
    expect(items[1]).toEqual({ description: 'Bottle', quantity: 1, value: 8 }) // no sku key
    expect(inSpy).toHaveBeenCalledWith('id', ['p1', 'p2'])
  })

  it('sends each product id once even when lines repeat it', async () => {
    const { admin, inSpy } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'S', source_product_id: 'p1', product_variants: null },
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'M', source_product_id: 'p1', product_variants: null },
      ],
      products: [{ id: 'p1', sku: 'TEE-001' }],
    })
    await loadStarshipitOrderItems(admin, 'q1')
    expect(inSpy).toHaveBeenCalledWith('id', ['p1'])
  })

  it('does not query products when no line has a source_product_id', async () => {
    const { admin, from } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: null, source_product_id: null, product_variants: null },
      ],
    })
    await loadStarshipitOrderItems(admin, 'q1')
    expect(from).not.toHaveBeenCalledWith('products')
  })

  it('leaves lines SKU-blank when the products read errors (best-effort, no throw)', async () => {
    const { admin } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'L', source_product_id: 'p1', product_variants: null },
      ],
      products: null,
      productsError: { message: 'boom' },
    })
    await expect(loadStarshipitOrderItems(admin, 'q1')).resolves.toEqual([
      { description: 'Tee — L', quantity: 1, value: 20 },
    ])
  })
})

describe('mapQuoteItemsToStarshipitItems — sku', () => {
  it('sets sku when the row carries a non-empty one', () => {
    const items = mapQuoteItemsToStarshipitItems([
      { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'L', sku: 'TEE-001', product_variants: null },
    ])
    expect(items[0].sku).toBe('TEE-001')
  })

  it('omits sku when the resolved value is empty/whitespace', () => {
    const items = mapQuoteItemsToStarshipitItems([
      { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: null, sku: '   ', product_variants: null },
    ])
    expect(items).toEqual([{ description: 'Tee', quantity: 1, value: 20 }])
  })
})
