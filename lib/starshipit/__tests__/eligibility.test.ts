import { describe, it, expect } from 'vitest'
import { evaluateStarshipitEligibility, type StarshipitEligibilityInput } from '../eligibility'

const base: StarshipitEligibilityInput = {
  enabled: true,
  intent: 'customer',
  isTestOrg: false,
  isStockOnHand: true,
  hasDeliveryAddress: true,
  orderType: null,
}

describe('evaluateStarshipitEligibility', () => {
  it('pushes a clean delivery order', () => {
    expect(evaluateStarshipitEligibility(base)).toEqual({ eligible: true, reason: 'ok' })
  })
  it('skips when the flag is off (checked first)', () => {
    expect(evaluateStarshipitEligibility({ ...base, enabled: false, isTestOrg: true }))
      .toEqual({ eligible: false, reason: 'disabled' })
  })
  it('skips test orgs (keep the real Starshipit account clean)', () => {
    expect(evaluateStarshipitEligibility({ ...base, isTestOrg: true }))
      .toEqual({ eligible: false, reason: 'test_org' })
  })
  it('skips inventory-intent orders (no customer delivery)', () => {
    expect(evaluateStarshipitEligibility({ ...base, intent: 'inventory' }))
      .toEqual({ eligible: false, reason: 'inventory_intent' })
  })
  it('skips a purchase-order (made-to-order) order — Starshipit is stock-only', () => {
    expect(evaluateStarshipitEligibility({ ...base, isStockOnHand: false }))
      .toEqual({ eligible: false, reason: 'not_stock_on_hand' })
  })
  it('precedence: inventory_intent beats not_stock_on_hand', () => {
    expect(evaluateStarshipitEligibility({ ...base, intent: 'inventory', isStockOnHand: false }))
      .toEqual({ eligible: false, reason: 'inventory_intent' })
  })
  it('precedence: not_stock_on_hand beats no_address', () => {
    expect(evaluateStarshipitEligibility({ ...base, isStockOnHand: false, hasDeliveryAddress: false }))
      .toEqual({ eligible: false, reason: 'not_stock_on_hand' })
  })
  it('skips non-delivery order types when a delivery/pickup discriminator is present', () => {
    expect(evaluateStarshipitEligibility({ ...base, orderType: 'pickup' }))
      .toEqual({ eligible: false, reason: 'non_delivery_type' })
  })
  it('skips when there is no usable delivery address', () => {
    expect(evaluateStarshipitEligibility({ ...base, hasDeliveryAddress: false }))
      .toEqual({ eligible: false, reason: 'no_address' })
  })
  it('precedence: disabled > test_org > inventory_intent > not_stock_on_hand > non_delivery_type > no_address', () => {
    expect(evaluateStarshipitEligibility({
      enabled: true, isTestOrg: true, intent: 'inventory', isStockOnHand: false,
      hasDeliveryAddress: false, orderType: 'pickup',
    })).toEqual({ eligible: false, reason: 'test_org' })
  })
})
