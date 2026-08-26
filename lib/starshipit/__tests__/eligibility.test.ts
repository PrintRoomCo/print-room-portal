import { describe, it, expect } from 'vitest'
import { evaluateStarshipitEligibility, type StarshipitEligibilityInput } from '../eligibility'

const base: StarshipitEligibilityInput = {
  enabled: true,
  trigger: 'placement',
  intent: 'customer',
  isTestOrg: false,
  alreadyPushed: false,
  isStockOnHand: true,
  hasDeliveryAddress: true,
  orderType: null,
  billCountry: 'NZ',
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
      enabled: true, trigger: 'placement', isTestOrg: true, intent: 'inventory',
      alreadyPushed: true, isStockOnHand: false,
      hasDeliveryAddress: false, orderType: 'pickup', billCountry: 'NZ',
    })).toEqual({ eligible: false, reason: 'test_org' })
  })
  it('skips an already-pushed order (idempotency, D6)', () => {
    expect(evaluateStarshipitEligibility({ ...base, alreadyPushed: true }))
      .toEqual({ eligible: false, reason: 'already_pushed' })
  })
  it('production_complete trigger: a made-to-order order IS eligible', () => {
    expect(evaluateStarshipitEligibility({ ...base, trigger: 'production_complete', isStockOnHand: false }))
      .toEqual({ eligible: true, reason: 'ok' })
  })
  it('production_complete trigger still requires a delivery address', () => {
    expect(evaluateStarshipitEligibility({
      ...base, trigger: 'production_complete', isStockOnHand: false, hasDeliveryAddress: false,
    })).toEqual({ eligible: false, reason: 'no_address' })
  })
  it('precedence: already_pushed beats not_stock_on_hand', () => {
    expect(evaluateStarshipitEligibility({ ...base, alreadyPushed: true, isStockOnHand: false }))
      .toEqual({ eligible: false, reason: 'already_pushed' })
  })
})

describe('evaluateStarshipitEligibility — AU bill country', () => {
  it('AU bill country → au_region, ordered after test_org', () => {
    const base = {
      enabled: true, trigger: 'placement' as const, intent: 'customer' as const,
      isTestOrg: false, alreadyPushed: false, isStockOnHand: true,
      hasDeliveryAddress: true, billCountry: 'AU',
    }
    expect(evaluateStarshipitEligibility(base)).toEqual({ eligible: false, reason: 'au_region' })
    // test_org wins over au_region
    expect(evaluateStarshipitEligibility({ ...base, isTestOrg: true })).toEqual({ eligible: false, reason: 'test_org' })
    // au_region wins over the downstream gates (e.g. stock gate)
    expect(evaluateStarshipitEligibility({ ...base, isStockOnHand: false })).toEqual({ eligible: false, reason: 'au_region' })
    // null bill country = NZ
    expect(evaluateStarshipitEligibility({ ...base, billCountry: null })).toEqual({ eligible: true, reason: 'ok' })
  })
})
