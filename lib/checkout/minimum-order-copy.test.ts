import { describe, expect, it } from 'vitest'
import { evaluateMinimumOrder } from './minimum-order'
import { MINIMUM_ORDER_CONTACT_EMAIL, minimumOrderCopy } from './minimum-order-copy'

function gated(value: number, currency = 'NZD') {
  return evaluateMinimumOrder({
    orderType: 'purchase_order',
    notionalValue: value,
    currency,
    exemptions: {
      orgExempt: false,
      isTest: false,
      isInventoryIntent: false,
      allPreOrder: false,
    },
  })
}

describe('minimumOrderCopy', () => {
  it('states the threshold, the order value and the shortfall', () => {
    const copy = minimumOrderCopy(gated(380))
    expect(copy.sentence).toBe(
      'Purchase orders have a $500 minimum (excl. GST). This order is $380. ' +
        'Add $120 to continue, or talk to us about smaller runs.',
    )
  })

  it('keeps cents when the amounts are not whole', () => {
    const copy = minimumOrderCopy(gated(379.5))
    expect(copy.sentence).toContain('This order is $379.50')
    expect(copy.sentence).toContain('Add $120.50 to continue')
  })

  it('softens the wording when an exemption may still apply', () => {
    const copy = minimumOrderCopy(gated(380), { tentative: true })
    expect(copy.sentence).toBe(
      'Purchase orders have a $500 minimum (excl. GST). This order may be below ' +
        'the minimum at $380. Add $120, or talk to us about smaller runs.',
    )
  })

  it('splits the sentence so the CTA can render as an inline link', () => {
    const copy = minimumOrderCopy(gated(380))
    expect(copy.sentence).toBe(`${copy.lead}${copy.ctaLabel}.`)
    expect(copy.ctaLabel).toBe('talk to us about smaller runs')
  })

  it('builds a mailto with a prefilled subject', () => {
    const copy = minimumOrderCopy(gated(380))
    expect(copy.mailto).toBe(
      `mailto:${MINIMUM_ORDER_CONTACT_EMAIL}?subject=${encodeURIComponent('Order below $500 minimum')}`,
    )
  })

  it('renders AUD amounts in AUD', () => {
    const copy = minimumOrderCopy(gated(460, 'AUD'))
    expect(copy.sentence).toContain('$500 minimum')
    expect(copy.sentence).toContain('This order is $460')
    expect(copy.sentence).toContain('Add $40 to continue')
  })
})
