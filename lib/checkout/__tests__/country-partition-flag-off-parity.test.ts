import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'monday-1', subitemIds: {} }),
}))
vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/email/order-placed-dispatch', () => ({
  sendOrderPlacedDispatch: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: 'proof-1', skipped: null }),
}))
vi.mock('@/lib/orders/job-tracker', () => ({
  createJobTrackerShellForOrder: vi
    .fn()
    .mockResolvedValue({ trackerId: 'tracker-1', trackerToken: 'fixed-token' }),
}))
vi.mock('@/lib/monday/updates', () => ({
  postItemUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/xero/draft-invoice', () => ({
  createDraftInvoiceForOrder: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'test' }),
}))
vi.mock('@/lib/starshipit/push-order', () => ({
  pushOrderToStarshipit: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'test' }),
}))
vi.mock('@/lib/notifications/slack-order-placed', () => ({
  postOrderPlacedSlack: vi.fn().mockResolvedValue({ success: true }),
}))

import { isCheckoutCountryPartitionEnabled } from '../country-partition-config'
import { buildCheckoutExecutionPlan } from '../execution-plan'
import { submitCustomerOrder, type CheckoutInput, type CheckoutLineInput } from '../submit'
import { pushOrderDeal } from '@/lib/monday/deal-item'
import { sendOrderConfirmation } from '@/lib/email/order-confirmation'
import { sendOrderPlacedDispatch } from '@/lib/email/order-placed-dispatch'
import { createJobTrackerShellForOrder } from '@/lib/orders/job-tracker'
import { createDraftInvoiceForOrder } from '@/lib/xero/draft-invoice'
import { pushOrderToStarshipit } from '@/lib/starshipit/push-order'
import { postOrderPlacedSlack } from '@/lib/notifications/slack-order-placed'
import { makeContext, makeFanoutStub, type StubConfig } from './fanout-test-stub'
import { legacyPartitionOracle } from './legacy-partition-oracle'

declare global {
  // Provided by vitest.setup.ts so Next's deferred `after()` effects can be observed.
  var flushAfter: () => Promise<void>
}

export interface CheckoutParityArtifact {
  partitions: Array<{ key: string; lineIds: string[]; idempotencyKey: string }>
  submitRpcArgs: unknown[]
  quoteUpdates: unknown[]
  orderUpdates: unknown[]
  xeroCalls: unknown[]
  starshipitCalls: unknown[]
  mondayCalls: unknown[]
  trackerCalls: unknown[]
  emailCalls: unknown[]
  slackCalls: unknown[]
}

const originalStarshipitEnabled = process.env.STARSHIPIT_ENABLED

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-24T01:02:03.000Z'))
  process.env.STARSHIPIT_ENABLED = 'true'
})

afterEach(() => {
  vi.useRealTimers()
  if (originalStarshipitEnabled === undefined) delete process.env.STARSHIPIT_ENABLED
  else process.env.STARSHIPIT_ENABLED = originalStarshipitEnabled
})

interface ParityFixture {
  name: string
  countryCode: 'NZ' | 'AU'
  orgRegion: 'NZ' | 'AU'
  currency: 'NZD' | 'AUD'
}

const parityFixtures: ParityFixture[] = [
  { name: 'NZ single-country checkout', countryCode: 'NZ', orgRegion: 'NZ', currency: 'NZD' },
  { name: 'AU single-country checkout', countryCode: 'AU', orgRegion: 'AU', currency: 'AUD' },
]

function parityWorld(fixture: ParityFixture, partitionIndex: number): StubConfig {
  return {
    items: [
      {
        id: 'item-tee',
        sourceProductId: 'product-tee',
        priceMode: 'computed',
        catalogueId: 'catalogue-1',
        poolingEnabled: true,
      },
    ],
    products: [{ id: 'product-tee', fulfilmentType: 'mixed' }],
    links: [
      {
        id: 'link-logo',
        catalogueItemId: 'item-tee',
        sourceProductId: 'product-tee',
        orgDecoration: {
          id: 'decoration-logo',
          organizationId: 'org-1',
          name: 'Logo',
          method: 'screenprint',
          unitPrice: 6,
        },
      },
    ],
    tier: null,
    garmentUnitPrice: 12.5,
    decorationRpcPrice: () => 6,
    organization: { region: fixture.orgRegion, isTest: true },
    enabledCountryCodes: [fixture.countryCode],
    submitResult: {
      quoteId: `quote-${partitionIndex + 1}`,
      orderId: `order-${partitionIndex + 1}`,
      orderRef: `ORD-${fixture.countryCode}-${partitionIndex + 1}`,
    },
  }
}

function parityLines(
  countryCode: 'NZ' | 'AU',
): Array<CheckoutLineInput & { ship_country: string }> {
  const decoration = {
    linkId: 'link-logo',
    decorationId: 'decoration-logo',
    name: 'Logo',
    method: 'screenprint',
    positionLabel: 'Front',
    unitPrice: 6,
    artworkUrl: null,
    snapshotUrl: null,
  }
  return [
    {
      cart_line_id: 'line-stock',
      product_id: 'product-tee',
      product_name: 'Stock tee',
      catalogueItemId: 'item-tee',
      qty: 40,
      fulfilment_type: 'stocked',
      ship_country: countryCode,
      decorations: [decoration],
    },
    {
      cart_line_id: 'line-po',
      product_id: 'product-tee',
      product_name: 'Made-to-order tee',
      catalogueItemId: 'item-tee',
      qty: 60,
      fulfilment_type: 'made_to_order',
      ship_country: countryCode,
      decorations: [decoration],
    },
  ]
}

function normalizeObservable<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, current: unknown) =>
      current instanceof Set ? [...current].sort() : current,
    ),
  ) as T
}

function capturedCalls(
  mock: { mock: { calls: unknown[][] } },
  argumentIndex = 0,
): unknown[] {
  return mock.mock.calls.map((call) => normalizeObservable(call[argumentIndex]))
}

async function executeParityFixture(
  fixture: ParityFixture,
  countryPartitionEnabled: boolean,
): Promise<CheckoutParityArtifact> {
  vi.clearAllMocks()
  const lines = parityLines(fixture.countryCode)
  const plan = buildCheckoutExecutionPlan(
    { idempotencyKey: `checkout-${fixture.countryCode.toLowerCase()}`, lines },
    countryPartitionEnabled,
  )
  const submitRpcArgs: unknown[] = []
  const quoteUpdates: unknown[] = []
  const orderUpdates: unknown[] = []

  for (const [partitionIndex, partition] of plan.partitions.entries()) {
    const stub = makeFanoutStub(parityWorld(fixture, partitionIndex))
    const input: CheckoutInput = {
      context: makeContext('org-1'),
      idempotency_key: partition.idempotencyKey,
      lines: partition.lines,
      pricing_pool_lines: lines,
      custom_shipping_address: {
        street: '1 Test Street',
        city: fixture.countryCode === 'AU' ? 'Melbourne' : 'Auckland',
        country: fixture.countryCode,
      },
    }
    await submitCustomerOrder(stub.admin, input)
    await globalThis.flushAfter()

    submitRpcArgs.push(
      ...stub.rpcCalls
        .filter((call) => call.name === 'submit_b2b_order')
        .map((call) =>
          normalizeObservable({
            ...call.args,
            pricing_pool_line_ids: input.pricing_pool_lines?.map((line) => line.cart_line_id),
          }),
        ),
    )
    quoteUpdates.push(
      ...stub.writeCalls
        .filter((call) => call.table === 'quotes')
        .map(({ operation, value, filters }) =>
          normalizeObservable({ operation, value, filters: [...filters] }),
        ),
    )
    orderUpdates.push(
      ...stub.writeCalls
        .filter((call) => call.table === 'orders')
        .map(({ operation, value, filters }) =>
          normalizeObservable({ operation, value, filters: [...filters] }),
        ),
    )
  }

  return {
    partitions: plan.partitions.map((partition) => ({
      key: partition.key,
      lineIds: partition.lines.map((line) => line.cart_line_id ?? line.product_id),
      idempotencyKey: partition.idempotencyKey,
    })),
    submitRpcArgs,
    quoteUpdates,
    orderUpdates,
    xeroCalls: capturedCalls(vi.mocked(createDraftInvoiceForOrder), 1),
    starshipitCalls: capturedCalls(vi.mocked(pushOrderToStarshipit), 1),
    mondayCalls: capturedCalls(vi.mocked(pushOrderDeal)),
    trackerCalls: capturedCalls(vi.mocked(createJobTrackerShellForOrder), 1),
    emailCalls: [
      ...capturedCalls(vi.mocked(sendOrderConfirmation)).map((call) => ({
        kind: 'confirmation',
        call,
      })),
      ...capturedCalls(vi.mocked(sendOrderPlacedDispatch)).map((call) => ({
        kind: 'dispatch',
        call,
      })),
    ],
    slackCalls: capturedCalls(vi.mocked(postOrderPlacedSlack)),
  }
}

describe('isCheckoutCountryPartitionEnabled', () => {
  it.each([undefined, '', '0', 'false'])(
    'keeps the country partition cutover dark for %j',
    (value) => {
      expect(
        isCheckoutCountryPartitionEnabled({
          CHECKOUT_COUNTRY_PARTITION_ENABLED: value,
        }),
      ).toBe(false)
    },
  )

  it.each(['1', 'true', 'on', 'yes', ' TRUE ', ' On ', 'YES'])(
    'enables the country partition cutover for %j',
    (value) => {
      expect(
        isCheckoutCountryPartitionEnabled({
          CHECKOUT_COUNTRY_PARTITION_ENABLED: value,
        }),
      ).toBe(true)
    },
  )
})

describe('buildCheckoutExecutionPlan flag-off parity', () => {
  it('matches the independent legacy partition order and suffixes for both flag states', () => {
    const stock = {
      cart_line_id: 'stock-line',
      product_id: 'stock-product',
      product_name: 'Stock product',
      qty: 10,
      fulfilment_type: 'stocked',
      ship_country: 'NZ',
    } as CheckoutLineInput
    const purchaseOrder = {
      cart_line_id: 'po-line',
      product_id: 'po-product',
      product_name: 'Made-to-order product',
      qty: 24,
      fulfilment_type: 'made_to_order',
      ship_country: 'NZ',
    } as CheckoutLineInput
    const lines = [stock, purchaseOrder]
    const expectedGroups = legacyPartitionOracle(lines)

    const off = buildCheckoutExecutionPlan(
      { idempotencyKey: 'checkout-1', lines },
      false,
    )
    const on = buildCheckoutExecutionPlan(
      { idempotencyKey: 'checkout-1', lines },
      true,
    )

    expect(
      on.partitions.map(({ countryCode: _countryCode, ...partition }) => partition),
    ).toStrictEqual(off.partitions)
    expect(off.partitions.map((partition) => partition.lines)).toStrictEqual(expectedGroups)
    expect(off.partitions.map((partition) => partition.idempotencyKey)).toStrictEqual([
      'checkout-1:po',
      'checkout-1:stock',
    ])
  })
})

describe('executable checkout flag-off parity oracle', () => {
  it.each(parityFixtures)(
    'keeps $name partitions, totals, legacy stamps, RPC input, and fan-out byte-identical',
    async (fixture) => {
      const off = await executeParityFixture(fixture, false)
      const on = await executeParityFixture(fixture, true)

      expect(on).toStrictEqual(off)
      expect(off.partitions).toStrictEqual([
        {
          key: 'purchase_order',
          lineIds: ['line-po'],
          idempotencyKey: `checkout-${fixture.countryCode.toLowerCase()}:po`,
        },
        {
          key: 'stock_on_hand',
          lineIds: ['line-stock'],
          idempotencyKey: `checkout-${fixture.countryCode.toLowerCase()}:stock`,
        },
      ])

      const rpcArgs = off.submitRpcArgs as Array<Record<string, unknown>>
      expect(rpcArgs.map((args) => args.pricing_pool_line_ids)).toStrictEqual([
        ['line-stock', 'line-po'],
        ['line-stock', 'line-po'],
      ])
      expect(
        rpcArgs.map((args) =>
          (args.p_lines as Array<Record<string, unknown>>).map((line) => ({
            quantity: line.quantity,
            unitPrice: line.unit_price,
            route: line.fulfilment_route,
          })),
        ),
      ).toStrictEqual([
        [{ quantity: 60, unitPrice: 18.5, route: 'purchase_order' }],
        [{ quantity: 40, unitPrice: 18.5, route: 'stock_draw' }],
      ])

      const billedUpdates = (off.quoteUpdates as Array<Record<string, unknown>>)
        .map((call) => call.value as Record<string, unknown>)
        .filter((value) => 'billed_total' in value)
      expect(billedUpdates).toStrictEqual([
        { picking_fee: 0, billed_total: 1110 },
        fixture.countryCode === 'NZ'
          ? { picking_fee: 15, billed_total: 755 }
          : { picking_fee: 0, billed_total: 740 },
      ])

      const orderTypeStamps = (off.orderUpdates as Array<Record<string, unknown>>)
        .map((call) => call.value as Record<string, unknown>)
        .filter((value) => 'order_type' in value)
      expect(orderTypeStamps).toStrictEqual([
        { order_type: 'purchase_order' },
        { order_type: 'stock_on_hand' },
      ])

      expect(off.trackerCalls).toHaveLength(2)
      expect(
        (off.trackerCalls as Array<Record<string, unknown>>).map((call) => call.currencyCode),
      ).toStrictEqual([fixture.currency, fixture.currency])
      expect(off.mondayCalls).toHaveLength(1)
      expect((off.mondayCalls[0] as Record<string, unknown>).currency).toBe(fixture.currency)
      expect(off.xeroCalls).toHaveLength(2)
      expect(
        (off.xeroCalls as Array<Record<string, unknown>>).map((call) => call.orgRegion),
      ).toStrictEqual([fixture.orgRegion, fixture.orgRegion])
      expect(off.starshipitCalls).toHaveLength(2)
      expect(
        (off.starshipitCalls as Array<Record<string, unknown>>).map((call) => call.region),
      ).toStrictEqual([fixture.orgRegion, fixture.orgRegion])
      expect(off.emailCalls).toHaveLength(2)
      expect(
        (off.emailCalls as Array<{ call: Record<string, unknown> }>).map(
          ({ call }) => call.currency,
        ),
      ).toStrictEqual([fixture.currency, fixture.currency])
      expect(off.slackCalls).toHaveLength(2)
    },
  )
})
