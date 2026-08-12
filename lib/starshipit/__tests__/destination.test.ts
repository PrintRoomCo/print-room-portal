import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isStoreShipment, loadOrdererName, resolveStarshipitDestination } from '../destination'

describe('isStoreShipment', () => {
  it('is true when the raw address carries a non-empty string id', () => {
    expect(isStoreShipment({ id: 'store-123', name: 'Reburger Takapuna' })).toBe(true)
  })
  it('is false for a missing, blank, or non-string id', () => {
    expect(isStoreShipment({ name: 'Jane Doe' })).toBe(false)
    expect(isStoreShipment({ id: '   ' })).toBe(false)
    expect(isStoreShipment({ id: 42 })).toBe(false)
    expect(isStoreShipment(null)).toBe(false)
  })
})

describe('resolveStarshipitDestination', () => {
  const storeAddress = {
    name: 'Reburger Takapuna',
    street: '1 Hurstmere Rd',
    city: 'Takapuna',
    country: 'New Zealand',
  }

  it('maps branch→company and orderer→name for a store shipment', () => {
    const out = resolveStarshipitDestination({
      address: storeAddress,
      rawAddress: { id: 'store-1', name: 'Reburger Takapuna' },
      ordererName: 'Jane Doe',
    })
    expect(out.company).toBe('Reburger Takapuna')
    expect(out.name).toBe('Jane Doe')
    expect(out.street).toBe('1 Hurstmere Rd') // other fields untouched
  })

  it('falls back to the branch name (company still set) when orderer is null', () => {
    const out = resolveStarshipitDestination({
      address: storeAddress,
      rawAddress: { id: 'store-1', name: 'Reburger Takapuna' },
      ordererName: null,
    })
    expect(out.company).toBe('Reburger Takapuna')
    expect(out.name).toBe('Reburger Takapuna')
  })

  it('returns a custom-address shipment unchanged (same reference)', () => {
    const custom = { name: 'Jane Doe', company: '', street: '9 Home St', city: 'Auckland' }
    const out = resolveStarshipitDestination({
      address: custom,
      rawAddress: { name: 'Jane Doe' }, // no id → custom
      ordererName: null,
    })
    expect(out).toBe(custom)
  })
})

describe('loadOrdererName', () => {
  function makeAdmin(result: { data: unknown; error: { message: string } | null }) {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    return { admin: { from } as unknown as SupabaseClient, from, select, eq }
  }

  it('returns the trimmed customer_name', async () => {
    const { admin, from, eq } = makeAdmin({ data: { customer_name: '  Jane Doe  ' }, error: null })
    await expect(loadOrdererName(admin, 'q1')).resolves.toBe('Jane Doe')
    expect(from).toHaveBeenCalledWith('quotes')
    expect(eq).toHaveBeenCalledWith('id', 'q1')
  })

  it('returns null on a query error (no throw)', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'boom' } })
    await expect(loadOrdererName(admin, 'q1')).resolves.toBeNull()
  })

  it('returns null when customer_name is empty/whitespace', async () => {
    const { admin } = makeAdmin({ data: { customer_name: '   ' }, error: null })
    await expect(loadOrdererName(admin, 'q1')).resolves.toBeNull()
  })
})
