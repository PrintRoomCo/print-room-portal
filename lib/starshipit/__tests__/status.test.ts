import { describe, expect, it } from 'vitest'
import { toParcelStatus } from '../status'

describe('toParcelStatus', () => {
  it.each([
    ['Printed', 'label_printed'],
    ['Dispatched', 'dispatched'],
    ['InTransit', 'in_transit'],
    ['AwaitingCollection', 'in_transit'],
    ['OutForDelivery', 'out_for_delivery'],
    ['Delivered', 'delivered'],
    ['PickupInStore', 'delivered'],
    ['AttemptedDelivery', 'exception'],
    ['Exception', 'exception'],
    ['Cancelled', 'cancelled'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(toParcelStatus(input)).toBe(expected)
  })

  it('returns null for unknown or missing statuses so the parcel write is skipped', () => {
    expect(toParcelStatus('SomethingNew')).toBeNull()
    expect(toParcelStatus(undefined)).toBeNull()
  })
})
