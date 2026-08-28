/**
 * One grouping of exploded lines by destination, shared by the review page, the
 * confirmation page and (Phase 2) the staff order view.
 *
 * Deliberately dependency-free: no supabase, no 'use client'. A server
 * component and a client component both import it, and three separate
 * implementations of "group lines by destination" is exactly how the picking-fee
 * country divergence happened.
 */
export interface DestinationSummaryLine {
  productName: string
  variantLabel?: string | null
  sizeLabel: string | null
  qty: number
}

export interface DestinationSummary {
  ref: string
  label: string
  /** Distinct product + colourway + size going to this destination. */
  skuCount: number
  /** Total units to this destination. */
  unitTotal: number
  /** null when the fee is not known yet, e.g. before the preview responds. */
  fee: number | null
  lines: DestinationSummaryLine[]
}

export function summariseDestinations(input: {
  destinations: Array<{ ref: string; label: string }>
  lines: Array<{
    destination_ref?: string | null
    product_name: string
    variant_label?: string | null
    size_label?: string | null
    qty: number
  }>
  feesByRef?: Record<string, number>
}): DestinationSummary[] {
  const linesByRef = new Map<string, DestinationSummaryLine[]>()
  for (const line of input.lines) {
    const ref = line.destination_ref
    if (!ref) continue
    const group = linesByRef.get(ref) ?? []
    group.push({
      productName: line.product_name,
      variantLabel: line.variant_label ?? null,
      sizeLabel: line.size_label ?? null,
      qty: line.qty,
    })
    linesByRef.set(ref, group)
  }

  return input.destinations.flatMap((destination) => {
    const lines = linesByRef.get(destination.ref)
    // A destination with nothing going to it is omitted rather than shown empty:
    // on a multi-country order its lines belong to the other country's order.
    if (!lines || lines.length === 0) return []

    const skus = new Set(
      lines.map((line) => `${line.productName}|${line.variantLabel ?? ''}|${line.sizeLabel ?? ''}`),
    )
    return [
      {
        ref: destination.ref,
        label: destination.label,
        skuCount: skus.size,
        unitTotal: lines.reduce((total, line) => total + line.qty, 0),
        fee: input.feesByRef?.[destination.ref] ?? null,
        lines,
      },
    ]
  })
}
