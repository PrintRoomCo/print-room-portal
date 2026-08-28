/**
 * How many units of each cart line go to each destination.
 * Keyed lineId -> destinationRef -> qty. A missing key means "nothing here",
 * which is why zero is never written: it keeps the map the same shape as the
 * request body's `allocations`, so building that is a plain map with no lookup.
 */
export type AllocationMap = Record<string, Record<string, number>>

/** A destination as the allocation fields need it: a ref and something to call it. */
export interface AllocationDestination {
  ref: string
  label: string
}

export function allocatedForLine(allocations: AllocationMap, lineId: string): number {
  return Object.values(allocations[lineId] ?? {}).reduce((total, qty) => total + qty, 0)
}

/** Positive = still to allocate, negative = over-allocated. */
export function remainingForLine(
  allocations: AllocationMap,
  lineId: string,
  qty: number,
): number {
  return qty - allocatedForLine(allocations, lineId)
}

/** True when the customer has said nothing about this line, so it ships whole to the default. */
export function lineFollowsDefault(allocations: AllocationMap, lineId: string): boolean {
  return Object.keys(allocations[lineId] ?? {}).length === 0
}
