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
  defaultDestinationRef: string | null
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
  defaultDestinationRef: null,
  allocations: {},
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
  if (
    !state.defaultDestinationRef ||
    !state.destinations.some((destination) => destination.ref === state.defaultDestinationRef)
  ) {
    return 'Choose which destination is the default.'
  }
  if (state.destinations.some((d) => !d.storeId && !d.customAddress)) {
    return 'Finish the address for every destination.'
  }

  const refs = new Set(state.destinations.map((d) => d.ref))
  const touched = new Set<string>()

  for (const line of cartLines) {
    const perDestination = state.allocations[line.lineId] ?? {}
    const entries = Object.entries(perDestination)
    if (entries.length === 0) {
      // Nothing said about this line: it ships whole to the default.
      touched.add(state.defaultDestinationRef)
      continue
    }
    let allocated = 0
    for (const [ref, qty] of entries) {
      // A stale ref (its destination was removed) invalidates rather than crashes.
      if (!refs.has(ref)) return 'Some units are assigned to a destination that no longer exists.'
      if (!Number.isInteger(qty) || qty <= 0) {
        return 'Every split line has to add up to its cart quantity.'
      }
      allocated += qty
      touched.add(ref)
    }
    if (allocated !== line.qty) return 'Every split line has to add up to its cart quantity.'
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
 * Remove a destination, moving whatever was going there to the default and
 * reporting how many units moved so the UI can say so out loud. Silently
 * dropping quantities is the one behaviour this editor must never have, and
 * leaving them stranded would hold the order in a blocked state the customer
 * did not ask for.
 */
export function removeDestination(
  state: SplitShipmentState,
  ref: string,
): { state: SplitShipmentState; movedUnits: number } {
  const destinations = state.destinations.filter((destination) => destination.ref !== ref)
  const defaultDestinationRef =
    state.defaultDestinationRef === ref
      ? destinations[0]?.ref ?? null
      : state.defaultDestinationRef

  let movedUnits = 0
  const allocations: AllocationMap = {}
  for (const [lineId, perDestination] of Object.entries(state.allocations)) {
    const kept: Record<string, number> = {}
    for (const [destinationRef, qty] of Object.entries(perDestination)) {
      if (destinationRef === ref) movedUnits += qty
      else kept[destinationRef] = qty
    }
    if (defaultDestinationRef === null) continue
    const moved = perDestination[ref] ?? 0
    if (moved > 0) kept[defaultDestinationRef] = (kept[defaultDestinationRef] ?? 0) + moved
    const keys = Object.keys(kept)
    // A line that now goes entirely to the default is a line the customer never
    // split: clear it so the row reads "to <default>" rather than a lone number.
    if (keys.length === 1 && keys[0] === defaultDestinationRef) continue
    if (keys.length > 0) allocations[lineId] = kept
  }

  return { state: { destinations, defaultDestinationRef, allocations }, movedUnits }
}
