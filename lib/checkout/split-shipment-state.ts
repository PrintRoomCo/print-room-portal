import type { CustomAddress } from '@/components/checkout/checkoutReviewState'
import type { AllocationMap } from './allocation'
import type { CheckoutDestinationInput } from './destinations'

/** A destination while the customer is still building the order. */
export interface EditorDestination {
  /** Generated once at add-time (crypto.randomUUID). Array indexes would break on removal. */
  ref: string
  storeId: string | null
  customAddress: CustomAddress | null
}

export interface SplitShipmentState {
  destinations: EditorDestination[]
  allocations: AllocationMap
}

/**
 * A cart line as the split logic reasons about it. Deliberately just the
 * identity and the quantity: allocation is per cart line, so nothing here needs
 * to know what product or colourway the line is.
 */
export interface EditorCartLine {
  lineId: string
  qty: number
}

export const EMPTY_SPLIT_STATE: SplitShipmentState = {
  destinations: [],
  allocations: {},
}

/**
 * The API requires a `default_destination_ref`: it is where the server sends a
 * line that carries no allocations. This editor never leaves one unallocated,
 * so the value is unreachable, and the first destination is as good a nominee
 * as any. Kept at the request boundary rather than in the state above, so the
 * customer is never asked to pick something that cannot be used.
 */
export function defaultDestinationRefForRequest(state: SplitShipmentState): string | null {
  return state.destinations[0]?.ref ?? null
}

/**
 * The first thing standing between this state and a submittable split order, in
 * a fixed order, phrased for the customer. `null` means nothing is.
 *
 * Evaluated against the LIVE cart lines, never against the allocation map's own
 * keys: the cart pill stays editable on this page, so a qty change or a removed
 * line must make the order incomplete rather than submit a payload the server
 * would bounce.
 */
export function splitBlockReason(
  state: SplitShipmentState,
  cartLines: EditorCartLine[],
): string | null {
  if (state.destinations.length === 0) {
    return 'Add a destination to split this order across.'
  }
  if (state.destinations.some((d) => !d.storeId && !d.customAddress)) {
    return 'Finish the address for every destination.'
  }

  const refs = new Set(state.destinations.map((d) => d.ref))
  const touched = new Set<string>()

  for (const line of cartLines) {
    const entries = Object.entries(state.allocations[line.lineId] ?? {})
    let allocated = 0
    for (const [ref, qty] of entries) {
      // A stale ref (its destination was removed) invalidates rather than crashes.
      if (!refs.has(ref)) return 'Some units are assigned to a destination that no longer exists.'
      if (!Number.isInteger(qty) || qty <= 0) {
        return 'Every line has to add up to its cart quantity.'
      }
      allocated += qty
      touched.add(ref)
    }
    // No default to fall back on: a line nobody assigned is an unfinished line.
    if (allocated !== line.qty) return 'Every line has to add up to its cart quantity.'
  }

  if (!state.destinations.every((d) => touched.has(d.ref))) {
    return 'Every destination needs at least one item.'
  }
  return null
}

/**
 * A thin wrapper so completeness and the message the customer reads can never
 * disagree about what "complete" means.
 */
export function splitShipmentComplete(
  state: SplitShipmentState,
  cartLines: EditorCartLine[],
): boolean {
  return splitBlockReason(state, cartLines) === null
}

/**
 * Per-line allocations in the request's shape. Lines the customer left alone
 * are omitted entirely: the server sends an unallocated line whole to the
 * default.
 */
export function buildSplitAllocations(
  state: SplitShipmentState,
  cartLines: EditorCartLine[],
): Record<string, Array<{ destination_ref: string; qty: number }>> {
  const out: Record<string, Array<{ destination_ref: string; qty: number }>> = {}
  const refs = new Set(state.destinations.map((d) => d.ref))
  for (const line of cartLines) {
    const entries = Object.entries(state.allocations[line.lineId] ?? {})
      .filter(([ref, qty]) => refs.has(ref) && Number.isInteger(qty) && qty > 0)
      .map(([ref, qty]) => ({ destination_ref: ref, qty }))
    if (entries.length > 0) out[line.lineId] = entries
  }
  return out
}

/** The destinations in request shape, in editor order. */
export function buildDestinationInputs(state: SplitShipmentState): CheckoutDestinationInput[] {
  return state.destinations.map((destination) => ({
    ref: destination.ref,
    ship_to_store_id: destination.storeId ?? null,
    custom_address: destination.storeId ? null : destination.customAddress,
  }))
}

/**
 * Remove a destination, reporting how many units it was holding so the UI can
 * say so out loud. Those units go back to being unallocated, which the affected
 * rows show as "N left": silently dropping quantities, or quietly re-homing
 * them somewhere the customer did not choose, is the one behaviour this editor
 * must never have.
 */
export function removeDestination(
  state: SplitShipmentState,
  ref: string,
): { state: SplitShipmentState; releasedUnits: number } {
  let releasedUnits = 0
  const allocations: AllocationMap = {}
  for (const [lineId, perDestination] of Object.entries(state.allocations)) {
    const kept: Record<string, number> = {}
    for (const [destinationRef, qty] of Object.entries(perDestination)) {
      if (destinationRef === ref) releasedUnits += qty
      else kept[destinationRef] = qty
    }
    if (Object.keys(kept).length > 0) allocations[lineId] = kept
  }

  return {
    state: {
      destinations: state.destinations.filter((destination) => destination.ref !== ref),
      allocations,
    },
    releasedUnits,
  }
}
