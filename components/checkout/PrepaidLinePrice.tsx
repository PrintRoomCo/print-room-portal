/**
 * The customer's "this line costs nothing" signal, in one place so /checkout and
 * /checkout/review cannot render it differently.
 *
 * `billed` must come from the billed shape (lib/pricing/order-billing-shape),
 * never from a local guess — the badge and the money are the same predicate by
 * construction (isPrepaidDrawn), and that is the point.
 */
export function PrepaidBadge() {
  return (
    <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      Pre-paid
    </span>
  )
}

export function PrepaidLinePrice({
  goodsValue,
  billed,
  format,
}: {
  /** Full goods value at current catalogue price — always shown. */
  goodsValue: number
  /** false ⇒ prepaid stock draw: struck through, invoiced at $0. */
  billed: boolean
  format: (nzdAmount: number) => string
}) {
  if (billed) {
    return <span className="font-semibold tabular-nums text-gray-900">{format(goodsValue)}</span>
  }
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <s className="tabular-nums text-gray-400">{format(goodsValue)}</s>
      <span aria-hidden="true" className="text-gray-400">
        →
      </span>
      <span className="font-semibold tabular-nums text-gray-900">{format(0)}</span>
      <span className="sr-only">— drawn from pre-paid stock, no charge</span>
    </span>
  )
}
