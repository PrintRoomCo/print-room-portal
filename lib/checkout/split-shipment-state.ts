import type { AllocationMap } from '@/components/checkout/AllocationGrid'
import type { CustomAddress } from '@/components/checkout/checkoutReviewState'
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
  /** Item keys the customer chose to split. Everything else follows the default. */
  splitItemKeys: string[]
  allocations: AllocationMap
}

export interface EditorCartLine {
  lineId: string
  productId: string
  variantId: string | null
  qty: number
}

export const EMPTY_SPLIT_STATE: SplitShipmentState = {
  destinations: [],
  defaultDestinationRef: null,
  splitItemKeys: [],
  allocations: {},
}

/**
 * "The item" in the grid is the group of cart lines sharing product and
 * colourway; its rows are the sizes. Splitting is chosen per item, not per size.
 */
export function itemKey(productId: string, variantId: string | null | undefined): string {
  return `${productId}::${variantId ?? ''}`
}

export function isItemSplit(state: SplitShipmentState, key: string): boolean {
  return state.splitItemKeys.includes(key)
}

/**
 * Every line of every split item must allocate exactly its cart quantity, and
 * every destination must receive something.
 *
 * Evaluated against the LIVE cart lines, never against the allocation map's own
 * keys: the cart pill stays editable on this page, so a qty change or a removed
 * line must make the order incomplete rather than submit a payload the server
 * would bounce.
 */
export function splitShipmentComplete(
  state: SplitShipmentState,
  cartLines: EditorCartLine[],
): boolean {
  if (state.destinations.length === 0 || !state.defaultDestinationRef) return false
  if (!state.destinations.some((d) => d.ref === state.defaultDestinationRef)) return false
  // A destination with no address is not shippable.
  if (state.destinations.some((d) => !d.storeId && !d.customAddress)) return false

  const refs = new Set(state.destinations.map((d) => d.ref))
  const touched = new Set<string>()

  for (const line of cartLines) {
    if (!isItemSplit(state, itemKey(line.productId, line.variantId))) {
      // Unsplit lines ship whole to the default destination.
      touched.add(state.defaultDestinationRef)
      continue
    }
    const perDestination = state.allocations[line.lineId] ?? {}
    let allocated = 0
    for (const [ref, qty] of Object.entries(perDestination)) {
      // A stale ref (its destination was removed) invalidates rather than crashes.
      if (!refs.has(ref)) return false
      if (!Number.isInteger(qty) || qty <= 0) return false
      allocated += qty
      touched.add(ref)
    }
    if (allocated !== line.qty) return false
  }

  return state.destinations.every((d) => touched.has(d.ref))
}

/**
 * Per-line allocations in the request's shape. Unsplit lines are omitted
 * entirely: the server sends an unallocated line whole to the default.
 */
export function buildSplitAllocations(
  state: SplitShipmentState,
  cartLines: EditorCartLine[],
): Record<string, Array<{ destination_ref: string; qty: number }>> {
  const out: Record<string, Array<{ destination_ref: string; qty: number }>> = {}
  const refs = new Set(state.destinations.map((d) => d.ref))
  for (const line of cartLines) {
    if (!isItemSplit(state, itemKey(line.productId, line.variantId))) continue
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
 * Remove a destination, reporting how many units were allocated to it so the UI
 * can say so out loud. Silently dropping quantities is the one behaviour this
 * editor must never have.
 */
export function removeDestination(
  state: SplitShipmentState,
  ref: string,
): { state: SplitShipmentState; discardedUnits: number } {
  let discardedUnits = 0
  const allocations: AllocationMap = {}
  for (const [lineId, perDestination] of Object.entries(state.allocations)) {
    const kept: Record<string, number> = {}
    for (const [destinationRef, qty] of Object.entries(perDestination)) {
      if (destinationRef === ref) discardedUnits += qty
      else kept[destinationRef] = qty
    }
    if (Object.keys(kept).length > 0) allocations[lineId] = kept
  }

  const destinations = state.destinations.filter((destination) => destination.ref !== ref)
  return {
    state: {
      ...state,
      destinations,
      allocations,
      defaultDestinationRef:
        state.defaultDestinationRef === ref
          ? destinations[0]?.ref ?? null
          : state.defaultDestinationRef,
    },
    discardedUnits,
  }
}
