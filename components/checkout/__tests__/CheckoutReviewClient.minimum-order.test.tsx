/**
 * The 422 path is the PRIMARY customer-facing block whenever
 * CHECKOUT_COUNTRY_PARTITION_ENABLED is off, because useCheckoutPreview does not
 * fire in that configuration. This test pins the mapping from the API body to the
 * banner, without standing up the whole review screen.
 */
import { describe, expect, it } from 'vitest'
import { minimumOrderCopy } from '@/lib/checkout/minimum-order-copy'
import { readMinimumOrderRejection } from '../CheckoutReviewClient'

describe('readMinimumOrderRejection', () => {
  it('renders the server message when the API sends one', () => {
    const status = {
      applies: true,
      met: false,
      threshold: 500,
      currency: 'NZD',
      value: 380,
      shortfall: 120,
    }
    expect(
      readMinimumOrderRejection({
        code: 'minimum_order_value',
        status,
        message: minimumOrderCopy(status).sentence,
      }),
    ).toContain('Add $120 to continue')
  })

  it('rebuilds the message from the status when the API omits it', () => {
    expect(
      readMinimumOrderRejection({
        code: 'minimum_order_value',
        status: {
          applies: true,
          met: false,
          threshold: 500,
          currency: 'AUD',
          value: 460,
          shortfall: 40,
        },
      }),
    ).toContain('Add $40 to continue')
  })

  it('falls back to a generic sentence when the body is unusable', () => {
    expect(readMinimumOrderRejection({})).toBe('This order could not be submitted.')
  })
})
