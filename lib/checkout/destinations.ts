import type { CustomAddress } from '@/components/checkout/checkoutReviewState'
import type { CheckoutLineInput } from './submit'

/**
 * One shipping destination on a split-shipment order, as the checkout sends it.
 * Exactly one of `ship_to_store_id` / `custom_address` must be set — the same
 * XOR the `order_destinations_one_address` DB constraint enforces.
 */
export interface CheckoutDestinationInput {
  /** Client-generated, unique within the order. Lines reference it by value. */
  ref: string
  ship_to_store_id?: string | null
  custom_address?: CustomAddress | null
  /**
   * Phase 3 (spec §9 "save-to-address-book polish"). Accepted so the request
   * shape is stable; nothing acts on it in Phase 1.
   */
  save_to_address_book?: boolean
}

export type DestinationFailure = {
  ok: false
  code:
    | 'no_destinations'
    | 'duplicate_ref'
    | 'destination_shape'
    | 'unknown_destination'
    | 'allocation_sum_mismatch'
    | 'invalid_allocation_qty'
    | 'empty_destination'
  detail: string
  cartLineId?: string | null
  destinationRef?: string
}

/** A per-destination copy of `line`, carrying `qty` units to `destination`. */
function rowForDestination(
  line: CheckoutLineInput,
  destination: CheckoutDestinationInput,
  qty: number,
): CheckoutLineInput {
  // Spread, never assign: the routes hand the SAME line objects to
  // pricing_pool_lines, so an in-place qty overwrite would corrupt the pool
  // that pricing and MOQ seed from.
  const row: CheckoutLineInput = {
    ...line,
    qty,
    destination_ref: destination.ref,
    ship_to_store_id: destination.ship_to_store_id ?? null,
  }
  delete row.allocations
  return row
}

/**
 * The split-shipment chokepoint: turn (lines + destinations + allocations) into
 * one line per destination, or a precise refusal the route can turn into a 400
 * pointing at the offending cart line / destination.
 *
 * Pure — no fetches, no org or store checks. "Does this store belong to the
 * org" is the route's job, because only the route has the org context.
 */
export function explodeCheckoutLines(input: {
  lines: CheckoutLineInput[]
  destinations: CheckoutDestinationInput[]
  defaultDestinationRef: string
}): { ok: true; lines: CheckoutLineInput[] } | DestinationFailure {
  const { lines, destinations, defaultDestinationRef } = input

  // 1. Destination-level validation, in a fixed order so error reporting is stable.
  if (destinations.length === 0) {
    return { ok: false, code: 'no_destinations', detail: 'A split order needs at least one destination.' }
  }

  const byRef = new Map<string, CheckoutDestinationInput>()
  for (const destination of destinations) {
    if (byRef.has(destination.ref)) {
      return {
        ok: false,
        code: 'duplicate_ref',
        detail: `Destination ref "${destination.ref}" is used more than once.`,
        destinationRef: destination.ref,
      }
    }
    byRef.set(destination.ref, destination)
  }

  for (const destination of destinations) {
    const hasStore = destination.ship_to_store_id != null && destination.ship_to_store_id !== ''
    const hasCustom = destination.custom_address != null
    if (hasStore === hasCustom) {
      return {
        ok: false,
        code: 'destination_shape',
        detail: hasStore
          ? 'A destination cannot have both a saved store and a one-time address.'
          : 'A destination needs either a saved store or a one-time address.',
        destinationRef: destination.ref,
      }
    }
  }

  if (!byRef.has(defaultDestinationRef)) {
    return {
      ok: false,
      code: 'unknown_destination',
      detail: `Default destination "${defaultDestinationRef}" is not one of the order's destinations.`,
      destinationRef: defaultDestinationRef,
    }
  }

  // 2. Per-line validation and explosion, lines in order.
  const allocatedRefs = new Set<string>()
  const exploded: CheckoutLineInput[] = []

  for (const line of lines) {
    const cartLineId = line.cart_line_id ?? null
    const allocations = line.allocations

    if (!allocations || allocations.length === 0) {
      // Unallocated lines ship whole to the order's default destination.
      allocatedRefs.add(defaultDestinationRef)
      exploded.push(rowForDestination(line, byRef.get(defaultDestinationRef)!, line.qty))
      continue
    }

    for (const allocation of allocations) {
      if (!byRef.has(allocation.destination_ref)) {
        return {
          ok: false,
          code: 'unknown_destination',
          detail: `Line allocates to unknown destination "${allocation.destination_ref}".`,
          cartLineId,
          destinationRef: allocation.destination_ref,
        }
      }
    }

    for (const allocation of allocations) {
      if (!Number.isInteger(allocation.qty) || allocation.qty <= 0) {
        return {
          ok: false,
          code: 'invalid_allocation_qty',
          detail: `Allocation quantities must be whole numbers above zero (got ${allocation.qty}).`,
          cartLineId,
          destinationRef: allocation.destination_ref,
        }
      }
    }

    const allocated = allocations.reduce((total, allocation) => total + allocation.qty, 0)
    if (allocated !== line.qty) {
      return {
        ok: false,
        code: 'allocation_sum_mismatch',
        detail: `Allocations total ${allocated} but the line has ${line.qty} units.`,
        cartLineId,
      }
    }

    for (const allocation of allocations) {
      allocatedRefs.add(allocation.destination_ref)
      exploded.push(rowForDestination(line, byRef.get(allocation.destination_ref)!, allocation.qty))
    }
  }

  // 3. Last: a destination nothing ships to is a mistake, not an empty parcel.
  for (const destination of destinations) {
    if (!allocatedRefs.has(destination.ref)) {
      return {
        ok: false,
        code: 'empty_destination',
        detail: 'Every destination needs at least one item allocated to it.',
        destinationRef: destination.ref,
      }
    }
  }

  return { ok: true, lines: exploded }
}
