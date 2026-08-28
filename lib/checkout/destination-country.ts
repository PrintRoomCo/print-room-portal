import type { CheckoutDestinationInput } from './destinations'
import { isoCountryOrNull } from './shipping-address'

/**
 * Which country a destination ships to, or null when it cannot be resolved.
 *
 * Null is a refusal, not a default: a caller that guessed NZ here would partition
 * the order into the wrong country and price it in the wrong currency. Both
 * routes turn null into a 400 naming the destination.
 *
 * `storeCountryById` is the org's OWN stores, so a store missing from the map is
 * either unknown or not this org's, and either way unusable.
 */
export function countryCodeForDestination(
  destination: CheckoutDestinationInput,
  storeCountryById: Map<string, string | null>,
): string | null {
  if (destination.ship_to_store_id) {
    return storeCountryById.get(destination.ship_to_store_id) ?? null
  }
  return isoCountryOrNull(destination.custom_address?.country ?? null)
}
