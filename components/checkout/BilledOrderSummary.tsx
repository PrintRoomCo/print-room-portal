import type { ReactNode } from 'react'
import { PickingFeeInfo } from '@/components/pricing/PickingFeeInfo'
import type {
  BilledLine,
  BilledOrderShape,
  BilledPartition,
  CheckoutBillingShape,
  CheckoutCountryGroup,
} from '@/lib/pricing/order-billing-shape'
import { formatCurrency } from '@/lib/currency/format'
import type { StoredPartitionOutcome } from './checkoutReviewState'

const ORDER_TYPE_LABEL: Record<BilledPartition['orderType'], string> = {
  purchase_order: 'Purchase order',
  stock_on_hand: 'Stock-on-hand order',
}

export interface CheckoutCountryFailure {
  partitionKey: string
  countryCode: string
  countryName: string
  currency: string
  code: string
  error: string
}

export function CountryBilledOrderSummary({
  shape,
  failures = [],
  partitionOutcomes = {},
  renderLine,
}: {
  shape: CheckoutBillingShape
  failures?: CheckoutCountryFailure[]
  partitionOutcomes?: Record<string, StoredPartitionOutcome>
  renderLine: (line: BilledLine, currency: string, countryName: string) => ReactNode
}) {
  const countries: Array<{
    key: string
    group: CheckoutCountryGroup | null
    countryName: string
    currency: string
    failures: CheckoutCountryFailure[]
  }> = shape.countryGroups.map((group) => ({
    key: group.countryCode,
    group,
    countryName: group.countryName,
    currency: group.currency,
    failures: failures.filter((failure) => failure.countryCode === group.countryCode),
  }))
  for (const failure of failures) {
    if (countries.some((country) => country.key === failure.countryCode)) continue
    countries.push({
      key: failure.countryCode,
      group: null,
      countryName: failure.countryName,
      currency: failure.currency,
      failures: failures.filter((item) => item.countryCode === failure.countryCode),
    })
  }
  const exact = (amount: number, currency: string) =>
    `${formatCurrency(amount, currency)} ${currency}`

  return (
    <div className="space-y-6">
      {countries.map(({ key, group, countryName, currency, failures: countryFailures }) => (
        <section key={key} className="rounded-[24px] bg-white p-5 md:p-6">
          <h2 className="text-lg font-medium text-black">
            {countryName} · {currency}
          </h2>

          {countryFailures.map((failure) => (
            <div
              key={failure.partitionKey}
              role="alert"
              tabIndex={-1}
              data-partition-error={failure.partitionKey}
              className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              {failure.error}
            </div>
          ))}

          {group?.partitions.map((partition) => (
            <section key={partition.key} className="mt-5 border-t border-black/10 pt-5">
              <h3 className="text-sm font-bold capitalize text-black">
                {ORDER_TYPE_LABEL[partition.orderType]}
              </h3>
              <PartitionPlacementOutcome
                partitionKey={partition.key}
                outcome={partitionOutcomes[partition.key]}
              />
              <div className="mt-4 space-y-6">
                {partition.lines.map((line) => (
                  <div key={line.lineId}>
                    {renderLine(line, currency, countryName)}
                    {line.repricedFromCurrency &&
                      line.repricedFromCurrency !== partition.currency && (
                        <p className="mt-2 text-xs text-black/60">
                          Repriced from {line.repricedFromCurrency} for delivery to {countryName}.
                        </p>
                      )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-baseline justify-between text-sm">
                <span className="text-black/60">Order total</span>
                <span className="font-medium tabular-nums text-black">
                  {exact(partition.total, currency)}
                </span>
              </div>
            </section>
          ))}

          {group && (
            <dl className="mt-5 space-y-2 border-t border-black/10 pt-5 text-sm">
              <CountryRow label="Subtotal" value={exact(group.subtotal, currency)} />
              {group.pickingFee > 0 && (
                <CountryRow label="Picking fee" value={exact(group.pickingFee, currency)} />
              )}
              <CountryRow label={group.taxLabel} value={exact(group.tax, currency)} />
              <CountryRow label="Country total" value={exact(group.total, currency)} bold />
            </dl>
          )}
        </section>
      ))}
    </div>
  )
}

function PartitionPlacementOutcome({
  partitionKey,
  outcome,
}: {
  partitionKey: string
  outcome?: StoredPartitionOutcome
}) {
  if (!outcome) return null
  if (outcome.ok) {
    return (
      <p role="status" className="mt-2 text-sm font-medium text-black">
        Placed · {outcome.orderRef}
      </p>
    )
  }
  return (
    <div
      role="alert"
      tabIndex={-1}
      data-partition-error={partitionKey}
      className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      {outcome.error}
    </div>
  )
}

function CountryRow({
  label,
  value,
  bold = false,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={bold ? 'font-medium text-black' : 'text-black/60'}>{label}</dt>
      <dd className={bold ? 'font-semibold tabular-nums text-black' : 'tabular-nums text-black'}>
        {value}
      </dd>
    </div>
  )
}

interface BilledOrderSummaryProps {
  shape: BilledOrderShape
  format: (nzdAmount: number) => string
  /** Renders one cart line row. Called per line, in partition order. */
  renderLine: (line: BilledLine) => ReactNode
  /** Review opens the breakdown by default; checkout leaves it collapsed. */
  defaultBreakdownOpen?: boolean
  /**
   * Order-level controls that belong with the lines rather than the totals.
   * /checkout puts its "Add all to my inventory" toggle here. Rendered after the
   * last line and before the grand total, which is where such a control reads
   * as applying to the items, not to the money.
   */
  afterLines?: ReactNode
}

/**
 * Flag-off compatibility renderer. It renders the legacy billed shape: line
 * rows grouped into the orders they will actually become, each order's own
 * fee/GST/total, and the legacy same-currency grand total. Flag-on checkout uses
 * CountryBilledOrderSummary and never mounts this renderer.
 *
 * Owns the STRUCTURE only; the caller passes `renderLine` because /checkout
 * renders a ship-to row and /checkout/review renders an image+decoration card.
 * Everything money-shaped lives here so the two pages cannot disagree, which is
 * the whole point of this work.
 *
 * A mixed cart shows its two groups because the split into two orders (and two
 * Xero quotes) is already real; today's single total just hides it.
 */
export function BilledOrderSummary({
  shape,
  format,
  renderLine,
  defaultBreakdownOpen = false,
  afterLines,
}: BilledOrderSummaryProps) {
  const multi = shape.invoiceCount > 1

  return (
    <>
      {shape.partitions.map((partition) => (
        <section
          key={partition.orderType}
          className={multi ? 'mb-5 rounded-2xl bg-white p-5' : undefined}
        >
          {multi && (
            <h3 className="mb-3 text-sm font-bold capitalize text-black">
              {ORDER_TYPE_LABEL[partition.orderType]}
            </h3>
          )}
          <div className="space-y-6">
            {partition.lines.map((line) => (
              <div key={line.lineId}>{renderLine(line)}</div>
            ))}
          </div>
          {multi && (
            <div className="mt-4 space-y-1.5 text-sm">
              <PartitionRows partition={partition} gstRate={shape.gstRate} format={format} />
              <div className="mt-1.5">
                <Row label="Order total" value={partition.total} bold format={format} />
              </div>
            </div>
          )}
        </section>
      ))}

      {afterLines}

      <div className="mt-8 flex items-baseline justify-between">
        <span className="text-base font-medium text-gray-900">
          {multi ? `Total across ${shape.invoiceCount} orders` : 'Total'}
        </span>
        <span className="text-xl font-medium text-gray-900">{format(shape.grandTotal)}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">incl. GST · billed per account terms</p>
      {multi && (
        <p className="mt-1 text-xs text-gray-500">
          You&apos;ll receive {shape.invoiceCount} invoices.
        </p>
      )}

      {!multi && shape.partitions.length === 1 && (
        <details open={defaultBreakdownOpen} className="mt-3">
          <summary className="cursor-pointer select-none text-xs text-gray-500 hover:text-gray-700">
            Show breakdown
          </summary>
          <div className="mt-3 space-y-1.5 text-sm">
            <PartitionRows
              partition={shape.partitions[0]}
              gstRate={shape.gstRate}
              format={format}
              showShipping
            />
            <div className="mt-2">
              <Row label="Total" value={shape.partitions[0].total} bold format={format} />
            </div>
          </div>
        </details>
      )}
    </>
  )
}

function PartitionRows({
  partition,
  gstRate,
  format,
  showShipping,
}: {
  partition: BilledPartition
  gstRate: number
  format: (n: number) => string
  showShipping?: boolean
}) {
  const hasPrepaid = partition.prepaidGoodsValue > 0
  return (
    <>
      <Row
        label={hasPrepaid ? 'Goods (pre-paid)' : 'Subtotal'}
        value={partition.billedSubtotal}
        format={format}
      />
      {/*
        Load-bearing, not decoration: once goods read $0 this is the ONLY place
        the picking-fee band basis appears. Without it the customer cannot tell
        why the fee is $15 rather than $35.
      */}
      {hasPrepaid && (
        <div className="flex items-baseline justify-between pl-3">
          <span className="text-xs text-gray-500">Drawn from pre-paid stock</span>
          <span className="text-xs tabular-nums text-gray-500">
            {format(partition.prepaidGoodsValue)}
          </span>
        </div>
      )}
      {showShipping && (
        <div className="flex items-baseline justify-between">
          <span className="text-gray-700">Shipping</span>
          <span className="font-medium text-gray-900">Included</span>
        </div>
      )}
      {partition.pickingFee > 0 && (
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1.5 text-gray-700">
            Picking fee
            <PickingFeeInfo goodsBasis={partition.goodsValueForBand} format={format} />
          </span>
          <span className="font-medium tabular-nums text-gray-900">
            {format(partition.pickingFee)}
          </span>
        </div>
      )}
      <Row label={`GST (${Math.round(gstRate * 100)}%)`} value={partition.gst} muted format={format} />
    </>
  )
}

function Row({
  label,
  value,
  bold,
  muted,
  format,
}: {
  label: string
  value: number
  bold?: boolean
  muted?: boolean
  format: (n: number) => string
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={muted ? 'text-gray-500' : 'text-gray-700'}>{label}</span>
      <span
        className={
          bold
            ? 'text-base font-semibold tabular-nums text-gray-900'
            : muted
              ? 'tabular-nums text-gray-700'
              : 'font-medium tabular-nums text-gray-900'
        }
      >
        {format(value)}
      </span>
    </div>
  )
}
