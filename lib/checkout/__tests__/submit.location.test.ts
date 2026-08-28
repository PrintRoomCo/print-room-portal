import { describe, it, expect } from 'vitest'
import { buildLineSnapshotUpdate } from '../submit'

describe('buildLineSnapshotUpdate', () => {
  it('includes line_location_label when provided', () => {
    const u = buildLineSnapshotUpdate({ ship_to_store_id: null, location_label: 'MTF Avalon' })
    expect(u).toMatchObject({ line_location_label: 'MTF Avalon' })
  })
  it('sets null when location_label is explicitly null', () => {
    const u = buildLineSnapshotUpdate({ location_label: null })
    expect(u.line_location_label).toBeNull()
  })
  it('omits line_location_label when the field is absent (legacy line)', () => {
    const u = buildLineSnapshotUpdate({})
    expect('line_location_label' in u).toBe(false)
  })

  it('omits ship_to_store_id from the snapshot update on split orders, the RPC owns it', () => {
    const u = buildLineSnapshotUpdate({ ship_to_store_id: 'store-a', location_label: 'Albany' }, { splitOrder: true })
    expect('ship_to_store_id' in u).toBe(false)
    expect(u).toMatchObject({ line_location_label: 'Albany' })
  })

  it('keeps stamping ship_to_store_id on legacy orders', () => {
    const u = buildLineSnapshotUpdate({ ship_to_store_id: 'store-a' }, { splitOrder: false })
    expect(u).toMatchObject({ ship_to_store_id: 'store-a' })
  })
})
