import { describe, expect, it } from 'vitest'

import { buildCheckoutExecutionPlan } from '../execution-plan'
import type { CheckoutLineInput } from '../submit'

function line(
  id: string,
  shipCountry: string,
  fulfilmentType: 'stocked' | 'made_to_order',
): CheckoutLineInput & { ship_country: string } {
  return {
    cart_line_id: id,
    product_id: `product-${id}`,
    product_name: id,
    qty: 10,
    fulfilment_type: fulfilmentType,
    ship_country: shipCountry,
  }
}

describe('buildCheckoutExecutionPlan country partitioning', () => {
  it('gives every multi-country partition a unique collision-safe idempotency key', () => {
    const lines = [
      line('au-stock', 'AU', 'stocked'),
      line('nz-stock', 'NZ', 'stocked'),
      line('au-po', 'AU', 'made_to_order'),
    ]

    const plan = buildCheckoutExecutionPlan(
      { idempotencyKey: 'checkout-1', lines, countryOrder: ['AU'] },
      true,
    )

    expect(plan.partitions.map(({ key, idempotencyKey }) => ({ key, idempotencyKey }))).toStrictEqual([
      { key: 'AU:purchase_order', idempotencyKey: 'checkout-1:au:po' },
      { key: 'AU:stock_on_hand', idempotencyKey: 'checkout-1:au:stock' },
      { key: 'NZ:stock_on_hand', idempotencyKey: 'checkout-1:nz:stock' },
    ])
  })

  it('rebuilds byte-identical multi-country keys for a retry', () => {
    const input = {
      idempotencyKey: 'checkout-retry',
      lines: [
        line('nz-stock', 'NZ', 'stocked'),
        line('au-stock', 'AU', 'stocked'),
      ],
      countryOrder: ['NZ'],
    }

    expect(buildCheckoutExecutionPlan(input, true)).toStrictEqual(
      buildCheckoutExecutionPlan(input, true),
    )
  })

  it('keeps one-country partitions and legacy suffixes byte-identical on and off', () => {
    const input = {
      idempotencyKey: 'checkout-nz',
      lines: [
        line('nz-stock', 'NZ', 'stocked'),
        line('nz-po', 'NZ', 'made_to_order'),
      ],
      countryOrder: ['NZ'],
    }

    const off = buildCheckoutExecutionPlan(input, false)
    const on = buildCheckoutExecutionPlan(input, true)

    expect(on.partitions.map(({ countryCode: _countryCode, ...partition }) => partition)).toStrictEqual(
      off.partitions,
    )
    expect(on.partitions.map((partition) => partition.idempotencyKey)).toStrictEqual([
      'checkout-nz:po',
      'checkout-nz:stock',
    ])
  })
})
