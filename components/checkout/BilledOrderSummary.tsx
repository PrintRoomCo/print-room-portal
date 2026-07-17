import type { ReactNode } from 'react'
import type {
  BilledLine,
  BilledOrderShape,
  BilledPartition,
} from '@/lib/pricing/order-billing-shape'

const ORDER_TYPE_LABEL: Record<BilledPartition['orderType'], string> = {
  purchase_order: 'Purchase order',
  stock_on_hand: 'Stock-on-hand order',
}

interface BilledOrderSummaryProps {
  shape: BilledOrderShape
  format: (nzdAmount: number) => string
  /** Renders one cart line row. Called per line, in partition order. */
  renderLine: (line: BilledLine) => ReactNode
  /** Review opens the breakdown by default; checkout leaves it collapsed. */
  defaultBreakdownOpen?: boolean
  /**
   * Order-level controls that belong with the lines rather than the totals —
   * /checkout puts its "Add all to my inventory" toggle here. Rendered after the
   * last line and before the grand total, which is where such a control reads
   * as applying to the items, not to the money.
   */
  afterLines?: ReactNode
}

/**
 * Renders the billed shape: line rows grouped into the orders they will actually
 * become, each order's own fee/GST/total, and the grand total.
 *
 * Owns the STRUCTURE only — the caller passes `renderLine` because /checkout
 * renders a ship-to row and /checkout/review renders an image+decoration card.
 * Everything money-shaped lives here so the two pages cannot disagree, which is
 * the whole point of this work.
 *
 * A mixed cart shows its two groups because the split into two orders (and two
 * Xero quotes) is already real — today's single total just hides it.
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
          className={multi ? 'mb-5 rounded-2xl border border-gray-100 p-5' : undefined}
        >
          {multi && (
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
              {ORDER_TYPE_LABEL[partition.orderType]}
            </h3>
          )}
          <div className="divide-y divide-gray-100">
            {partition.lines.map((line) => (
              <div key={line.lineId}>{renderLine(line)}</div>
            ))}
          </div>
          {multi && (
            <div className="mt-4 space-y-1.5 border-t border-gray-200 pt-3 text-sm">
              <PartitionRows partition={partition} gstRate={shape.gstRate} format={format} />
              <div className="border-t border-gray-100 pt-1.5">
                <Row label="Order total" value={partition.total} bold format={format} />
              </div>
            </div>
          )}
        </section>
      ))}

      {afterLines}

      <div className="mt-6 flex items-baseline justify-between border-t border-gray-200 pt-5">
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
            <div className="mt-1 border-t border-gray-100 pt-1.5">
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
        <Row label="Picking fee" value={partition.pickingFee} format={format} />
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
