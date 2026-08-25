import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveUnitPriceForItem, effectiveUnitPricesForItemsBulk } from './effective-price'

function mockAdmin(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return { admin: { rpc } as unknown as SupabaseClient, rpc }
}

describe('effectiveUnitPriceForItem', () => {
  it('maps item/org/qty params and returns Number(data)', async () => {
    const { admin, rpc } = mockAdmin({ data: '40.75' })
    const price = await effectiveUnitPriceForItem(admin, 'item-1', 'org-1', 12)
    expect(rpc).toHaveBeenCalledWith('effective_unit_price_for_item', {
      p_catalogue_item_id: 'item-1',
      p_org_id: 'org-1',
      p_qty: 12,
    })
    expect(price).toBe(40.75)
  })

  it('coerces null data to 0', async () => {
    const { admin } = mockAdmin({ data: null })
    expect(await effectiveUnitPriceForItem(admin, 'item-1', 'org-1', 1)).toBe(0)
  })

  it('throws on error', async () => {
    const { admin } = mockAdmin({ error: new Error('boom') })
    await expect(effectiveUnitPriceForItem(admin, 'item-1', 'org-1', 1)).rejects.toThrow('boom')
  })

  it('uses the exact target-currency RPC when country partitioning is enabled', async () => {
    const { admin, rpc } = mockAdmin({ data: '25.40' })

    await expect(
      effectiveUnitPriceForItem(admin, 'item-au', 'org-1', 100, 'AUD', true),
    ).resolves.toBe(25.4)
    expect(rpc).toHaveBeenCalledWith('effective_unit_price_for_item_currency', {
      p_catalogue_item_id: 'item-au',
      p_org_id: 'org-1',
      p_qty: 100,
      p_currency: 'AUD',
    })
  })

  it('preserves an authored zero and returns null only when the target list is missing', async () => {
    const zero = mockAdmin({ data: 0 })
    await expect(
      effectiveUnitPriceForItem(zero.admin, 'item-au', 'org-1', 100, 'AUD', true),
    ).resolves.toBe(0)

    const missing = mockAdmin({ data: null })
    await expect(
      effectiveUnitPriceForItem(missing.admin, 'item-au', 'org-1', 100, 'AUD', true),
    ).resolves.toBeNull()
  })

  it('keeps the legacy RPC name and arguments byte-identical when the flag is off', async () => {
    const { admin, rpc } = mockAdmin({ data: 12 })
    await effectiveUnitPriceForItem(admin, 'item-1', 'org-1', 24, 'AUD', false)
    expect(rpc).toHaveBeenCalledWith('effective_unit_price_for_item', {
      p_catalogue_item_id: 'item-1',
      p_org_id: 'org-1',
      p_qty: 24,
    })
  })
})

describe('effectiveUnitPricesForItemsBulk', () => {
  it('maps array + jsonb params and returns a Map keyed by catalogue_item_id', async () => {
    const { admin, rpc } = mockAdmin({
      data: [
        { catalogue_item_id: 'a', unit_price: 40.75 },
        { catalogue_item_id: 'b', unit_price: '12.37' },
      ],
    })
    const map = await effectiveUnitPricesForItemsBulk(admin, ['a', 'b'], 'org-1', { a: 12, b: 50 })
    expect(rpc).toHaveBeenCalledWith('effective_unit_prices_for_items_bulk', {
      p_catalogue_item_ids: ['a', 'b'],
      p_org_id: 'org-1',
      p_qty_by_item: { a: 12, b: 50 },
    })
    expect(map.get('a')).toBe(40.75)
    expect(map.get('b')).toBe(12.37)
    expect(map.size).toBe(2)
  })

  it('returns an empty Map when data is null', async () => {
    const { admin } = mockAdmin({ data: null })
    const map = await effectiveUnitPricesForItemsBulk(admin, ['a'], 'org-1', { a: 1 })
    expect(map.size).toBe(0)
  })

  it('throws on error', async () => {
    const { admin } = mockAdmin({ error: new Error('bulk-boom') })
    await expect(
      effectiveUnitPricesForItemsBulk(admin, ['a'], 'org-1', { a: 1 }),
    ).rejects.toThrow('bulk-boom')
  })
})
