import { describe, it, expect } from 'vitest'
import { xeroShipToStoreId } from './xero-ship-to'

describe('xeroShipToStoreId', () => {
  it('split orders always invoice the org, never a destination store', () => {
    expect(
      xeroShipToStoreId({
        splitShipment: true,
        lines: [{ ship_to_store_id: 'store-a' }, { ship_to_store_id: 'store-a' }],
      }),
    ).toBeNull()
  })

  it('single-destination orders keep the store contact when every line agrees', () => {
    expect(
      xeroShipToStoreId({
        splitShipment: false,
        lines: [{ ship_to_store_id: 'store-a' }, { ship_to_store_id: 'store-a' }],
      }),
    ).toBe('store-a')
  })

  it('mixed or custom-address lines resolve to the org, never silently to lines[0]', () => {
    expect(
      xeroShipToStoreId({
        splitShipment: false,
        lines: [{ ship_to_store_id: 'store-a' }, { ship_to_store_id: 'store-b' }],
      }),
    ).toBeNull()
    expect(
      xeroShipToStoreId({ splitShipment: false, lines: [{ ship_to_store_id: null }] }),
    ).toBeNull()
    expect(xeroShipToStoreId({ splitShipment: false, lines: [] })).toBeNull()
  })
})
