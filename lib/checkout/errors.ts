import type { BillingMode } from '@/lib/shop/billing-mode'
import type { MinimumOrderStatus } from '@/lib/checkout/minimum-order'
import { minimumOrderCopy } from '@/lib/checkout/minimum-order-copy'

export interface DecorationDrift {
  cartLineId: string | null
  productId: string
  linkId: string
  decorationName: string
  was: number
  now: number
  reason: 'price_drift' | 'detached' | 'cross_org' | 'inactive' | 'wrong_item'
}

export class DecorationDriftError extends Error {
  readonly drift: DecorationDrift[]
  constructor(drift: DecorationDrift[]) {
    super('decoration_price_drift')
    this.name = 'DecorationDriftError'
    this.drift = drift
  }
}

export interface UnitPriceDrift {
  cartLineId: string | null
  productId: string
  productName: string
  qty: number
  claimedUnitPrice: number
  canonicalUnitPrice: number
}

export class UnitPriceDriftError extends Error {
  readonly drift: UnitPriceDrift[]
  constructor(drift: UnitPriceDrift[]) {
    super('unit_price_drift')
    this.name = 'UnitPriceDriftError'
    this.drift = drift
  }
}

export interface BillingModeDrift {
  cartLineId: string | null
  productId: string
  productName: string
  claimedBillingMode: BillingMode
  canonicalBillingMode: BillingMode
}

export class BillingModeDriftError extends Error {
  readonly drift: BillingModeDrift[]
  constructor(drift: BillingModeDrift[]) {
    super('billing_mode_drift')
    this.name = 'BillingModeDriftError'
    this.drift = drift
  }
}

export interface AccessDrift {
  cartLineId: string | null
  productId: string
  productName: string
}

export class MemberAccessDriftError extends Error {
  readonly drift: AccessDrift[]
  constructor(drift: AccessDrift[]) {
    super('member_access_drift')
    this.name = 'MemberAccessDriftError'
    this.drift = drift
  }
}

export interface StockShortfallDetail {
  code: 'insufficient_stock' | 'no_inventory'
  product_id: string | null
  variant_id: string | null
  available?: number
  requested?: number
}

export class StockShortfallError extends Error {
  readonly detail: StockShortfallDetail
  constructor(detail: StockShortfallDetail) {
    super(detail.code)
    this.name = 'StockShortfallError'
    this.detail = detail
  }
}

export interface MoqViolation {
  cartLineId: string | null
  productId: string
  productName: string
  effectiveMoq: number
  totalQty: number
}

export class MoqViolationError extends Error {
  readonly violations: MoqViolation[]
  constructor(violations: MoqViolation[]) {
    super('moq_violation')
    this.name = 'MoqViolationError'
    this.violations = violations
  }
}

export class BuyerScopeError extends Error {
  readonly mismatchedStoreIds: Array<string | null>
  readonly defaultStoreId: string | null
  constructor(mismatchedStoreIds: Array<string | null>, defaultStoreId: string | null) {
    super('buyer_ship_to_mismatch')
    this.name = 'BuyerScopeError'
    this.mismatchedStoreIds = mismatchedStoreIds
    this.defaultStoreId = defaultStoreId
  }
}

export class MixedShippingAddressError extends Error {
  constructor() {
    super('mixed_shipping_address')
    this.name = 'MixedShippingAddressError'
  }
}

export class DisabledCountryError extends Error {
  constructor(public readonly country: string) {
    super(`Shipping country ${country || '(none)'} is not enabled for this organisation`)
    this.name = 'DisabledCountryError'
  }
}

export class CountryPriceUnavailableError extends Error {
  readonly code = 'country_price_unavailable'

  constructor(
    readonly detail: {
      cartLineId: string | null
      productId: string
      productName: string
      countryCode: string
      currency: string
      component: 'garment' | 'stock' | 'decoration' | 'period'
    },
  ) {
    super(`${detail.productName} is not orderable to ${detail.countryCode} yet`)
    this.name = 'CountryPriceUnavailableError'
  }
}

export class MinimumOrderValueError extends Error {
  readonly code = 'minimum_order_value'
  readonly status: MinimumOrderStatus

  constructor(status: MinimumOrderStatus) {
    // The message IS the customer-facing sentence, not a code. With country
    // partitioning on, submit failures come back as a 207 outcome whose `error`
    // string is rendered verbatim (app/api/checkout/route.ts:388), so a bare
    // code would surface to the customer as gibberish.
    super(minimumOrderCopy(status).sentence)
    this.name = 'MinimumOrderValueError'
    this.status = status
  }
}
