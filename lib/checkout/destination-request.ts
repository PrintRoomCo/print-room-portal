import { countryCodeForDestination } from './destination-country'
import {
  explodeCheckoutLines,
  type CheckoutDestinationInput,
} from './destinations'
import type { CheckoutLineInput } from './submit'

export interface DestinationRequestRejection {
  ok: false
  status: number
  body: Record<string, unknown>
}

export interface DestinationRequestAccepted {
  ok: true
  destinations: CheckoutDestinationInput[]
  defaultDestinationRef: string
  /** The exploded lines: one row per destination, server-stamped. */
  lines: CheckoutLineInput[]
  /** Resolved ISO country per destination ref. */
  countryByRef: Map<string, string>
}

function reject(status: number, body: Record<string, unknown>): DestinationRequestRejection {
  return { ok: false, status, body }
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Everything a checkout route must prove about a split-shipment request before
 * it prices anything, in one pure pass: the org may split at all, each
 * destination is well-formed and belongs to the org, a branch-scoped buyer is
 * staying inside their grants, the allocations add up, and every destination
 * resolves to a country.
 *
 * Deliberately pure. The caller fetches the flag, the org's stores and the
 * buyer's branch grants (those differ between preview and submit, which is why
 * this does NOT try to own auth) and passes the results in. What it composes is
 * the three seams: explodeCheckoutLines, countryCodeForDestination, and the
 * shape rules.
 */
export function validateDestinationRequest(input: {
  destinations: unknown
  defaultDestinationRef: unknown
  lines: CheckoutLineInput[]
  splitShippingEnabled: boolean
  /** The ORG's own stores only: id to ISO country (null when the store has none). */
  orgStoreCountryById: Map<string, string | null>
  /** Non-null only for branch-scoped (staff role) buyers. */
  staffScope: { allowedBranchIds: string[]; defaultStoreId: string | null } | null
}): DestinationRequestAccepted | DestinationRequestRejection {
  const { destinations, defaultDestinationRef, lines, orgStoreCountryById, staffScope } = input

  if (!input.splitShippingEnabled) {
    return reject(400, {
      error: 'Split shipment is not enabled for your organisation.',
      code: 'split_shipping_disabled',
    })
  }

  if (!Array.isArray(destinations) || destinations.length === 0) {
    return reject(400, {
      error: 'A split order needs at least one destination.',
      code: 'no_destinations',
    })
  }
  if (!nonEmptyString(defaultDestinationRef)) {
    return reject(400, {
      error: 'default_destination_ref is required when destinations are supplied.',
      code: 'unknown_destination',
    })
  }

  const parsed: CheckoutDestinationInput[] = []
  for (const raw of destinations) {
    if (typeof raw !== 'object' || raw === null) {
      return reject(400, { error: 'Malformed destination.', code: 'destination_shape' })
    }
    const destination = raw as CheckoutDestinationInput
    if (!nonEmptyString(destination.ref)) {
      return reject(400, {
        error: 'Every destination needs a ref.',
        code: 'destination_shape',
      })
    }
    // Ad-hoc addresses must be complete enough to actually ship to. Google
    // Places fills these, but the manual escape hatch means we re-check here.
    if (destination.custom_address != null) {
      const address = destination.custom_address
      const missing = (['address', 'city', 'postal_code', 'country'] as const).filter(
        (field) => !nonEmptyString(address[field]),
      )
      if (missing.length > 0) {
        return reject(400, {
          error: `One-time address is missing: ${missing.join(', ')}.`,
          code: 'destination_shape',
          destinationRef: destination.ref,
        })
      }
    }
    // Ownership: a client must not be able to name a store it does not own.
    if (destination.ship_to_store_id != null) {
      if (!orgStoreCountryById.has(destination.ship_to_store_id)) {
        return reject(400, {
          error: `Store ${destination.ship_to_store_id} not on your account`,
          code: 'unknown_destination',
          destinationRef: destination.ref,
        })
      }
    }
    parsed.push(destination)
  }

  // Branch-scoped buyers ship only to granted branches, and never to an ad-hoc
  // address (they cannot invent a destination outside their scope).
  if (staffScope) {
    const allowed = new Set(staffScope.allowedBranchIds)
    const adHoc = parsed.filter((destination) => destination.ship_to_store_id == null)
    if (adHoc.length > 0) {
      return reject(403, {
        error: 'buyer_ship_to_mismatch',
        code: 'destination_out_of_branch_scope',
        detail: { default_store_id: staffScope.defaultStoreId },
      })
    }
    const mismatched = parsed
      .map((destination) => destination.ship_to_store_id)
      .filter((storeId): storeId is string => typeof storeId === 'string' && !allowed.has(storeId))
    if (mismatched.length > 0) {
      return reject(403, {
        error: 'buyer_ship_to_mismatch',
        code: 'destination_out_of_branch_scope',
        detail: { mismatched_store_ids: mismatched, default_store_id: staffScope.defaultStoreId },
      })
    }
  }

  const exploded = explodeCheckoutLines({
    lines,
    destinations: parsed,
    defaultDestinationRef: defaultDestinationRef as string,
  })
  if (!exploded.ok) {
    return reject(400, {
      error: exploded.detail,
      code: exploded.code,
      cartLineId: exploded.cartLineId ?? null,
      destinationRef: exploded.destinationRef,
    })
  }

  // Null is a refusal, never a default: guessing a country would partition the
  // order into the wrong currency.
  const countryByRef = new Map<string, string>()
  for (const destination of parsed) {
    const countryCode = countryCodeForDestination(destination, orgStoreCountryById)
    if (!countryCode) {
      return reject(400, {
        error: 'Could not resolve a shipping country for this destination.',
        code: 'destination_country_unresolved',
        destinationRef: destination.ref,
      })
    }
    countryByRef.set(destination.ref, countryCode)
  }

  return {
    ok: true,
    destinations: parsed,
    defaultDestinationRef: defaultDestinationRef as string,
    lines: exploded.lines,
    countryByRef,
  }
}
