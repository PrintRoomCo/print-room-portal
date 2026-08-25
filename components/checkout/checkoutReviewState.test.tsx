import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHECKOUT_REVIEW_STORAGE_KEY,
  readCheckoutReviewState,
} from './checkoutReviewState'

const baseState = {
  idempotencyKey: 'idem-1',
  requiredBy: '',
  notes: '',
  intent: 'customer',
  perLineShipTo: { 'line-1': 'store-1' },
  customAddress: {
    name: '', address: '', city: '', postal_code: '', country: 'NZ',
  },
  createdAt: '2026-08-25T00:00:00.000Z',
}

beforeEach(() => sessionStorage.clear())

describe('checkout review persistence', () => {
  it('hydrates legacy state without partition outcomes', () => {
    sessionStorage.setItem(CHECKOUT_REVIEW_STORAGE_KEY, JSON.stringify(baseState))

    expect(readCheckoutReviewState()).toMatchObject({ partitionOutcomes: {} })
  })

  it('preserves successful refs and named failures for an idempotent retry', () => {
    sessionStorage.setItem(CHECKOUT_REVIEW_STORAGE_KEY, JSON.stringify({
      ...baseState,
      partitionOutcomes: {
        'AU:purchase_order': {
          ok: true, partitionKey: 'AU:purchase_order', orderId: 'order-au', orderRef: 'AU-1',
        },
        'NZ:stock_on_hand': {
          ok: false, partitionKey: 'NZ:stock_on_hand', code: 'xero', error: 'Try NZ again.',
        },
      },
    }))

    expect(readCheckoutReviewState()?.partitionOutcomes).toEqual({
      'AU:purchase_order': {
        ok: true, partitionKey: 'AU:purchase_order', orderId: 'order-au', orderRef: 'AU-1',
      },
      'NZ:stock_on_hand': {
        ok: false, partitionKey: 'NZ:stock_on_hand', code: 'xero', error: 'Try NZ again.',
      },
    })
  })
})
