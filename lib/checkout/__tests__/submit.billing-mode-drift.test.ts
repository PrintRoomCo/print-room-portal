import { describe, it, expect } from 'vitest'
import { buildBillingModeDrift } from '../submit'
import type { BillingMode } from '@/lib/shop/billing-mode'

describe('buildBillingModeDrift', () => {
  const canonical = new Map<string, BillingMode>([
    ['v-prepaid', 'prepaid'],
    ['v-billed', 'invoice_on_dispatch'],
  ])

  const line = (over: Record<string, unknown> = {}) => ({
    product_id: 'p1',
    product_name: 'Staple Tee',
    variant_id: 'v-prepaid',
    cart_line_id: 'l1',
    ...over,
  })

  it('is empty when the claim matches', () => {
    expect(
      buildBillingModeDrift([line({ claimed_billing_mode: 'prepaid' })], canonical),
    ).toEqual([])
  })

  // Drift AGAINST the customer: they'd be charged for goods the page showed at $0.
  it('flags a claim of prepaid on a variant that is now billed', () => {
    expect(
      buildBillingModeDrift(
        [line({ variant_id: 'v-billed', claimed_billing_mode: 'prepaid' })],
        canonical,
      ),
    ).toEqual([
      {
        cartLineId: 'l1',
        productId: 'p1',
        productName: 'Staple Tee',
        claimedBillingMode: 'prepaid',
        canonicalBillingMode: 'invoice_on_dispatch',
      },
    ])
  })

  // Drift FOR the customer still 409s: the page disagreed with the quote, and
  // that disagreement is the whole defect being fixed.
  it('flags a claim of billed on a variant that is now prepaid', () => {
    expect(
      buildBillingModeDrift([line({ claimed_billing_mode: 'invoice_on_dispatch' })], canonical),
    ).toHaveLength(1)
  })

  it('skips a line with no claim (legacy cart)', () => {
    expect(buildBillingModeDrift([line()], canonical)).toEqual([])
    expect(buildBillingModeDrift([line({ claimed_billing_mode: null })], canonical)).toEqual([])
  })

  it('treats an unknown variant as invoice_on_dispatch (fail closed)', () => {
    expect(
      buildBillingModeDrift(
        [line({ variant_id: 'v-gone', claimed_billing_mode: 'prepaid' })],
        canonical,
      ),
    ).toHaveLength(1)
  })

  it('treats a variantless line as invoice_on_dispatch', () => {
    expect(
      buildBillingModeDrift(
        [line({ variant_id: null, claimed_billing_mode: 'invoice_on_dispatch' })],
        canonical,
      ),
    ).toEqual([])
  })

  it('reports every drifting line, not just the first', () => {
    expect(
      buildBillingModeDrift(
        [
          line({ claimed_billing_mode: 'invoice_on_dispatch' }),
          line({ cart_line_id: 'l2', variant_id: 'v-billed', claimed_billing_mode: 'prepaid' }),
        ],
        canonical,
      ),
    ).toHaveLength(2)
  })
})
