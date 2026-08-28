import type { CustomAddress } from '@/components/checkout/checkoutReviewState'

/** One entry of Google Places (New) `addressComponents`. */
export interface PlaceAddressComponent {
  types: string[]
  longText: string
  shortText?: string
}

export type PlaceAddressComponents = PlaceAddressComponent[]

export interface PlaceSuggestion {
  placeId: string
  label: string
}

function componentFor(
  components: PlaceAddressComponents,
  type: string,
): PlaceAddressComponent | undefined {
  return components.find((component) => component.types.includes(type))
}

/**
 * Google address components to the CustomAddress the checkout speaks.
 *
 * Returns null rather than a partial address when the pick is not shippable: a
 * suburb- or city-level result has no street, and a courier cannot deliver to
 * it. The caller offers the manual fields instead.
 */
export function mapPlaceToCustomAddress(
  components: PlaceAddressComponents,
  fallbackName: string,
): CustomAddress | null {
  const route = componentFor(components, 'route')
  const locality = componentFor(components, 'locality')
  const country = componentFor(components, 'country')
  if (!route || !locality || !country) return null

  const streetNumber = componentFor(components, 'street_number')
  const address = [streetNumber?.longText, route.longText].filter(Boolean).join(' ').trim()
  if (!address) return null

  return {
    name: fallbackName,
    address,
    city: locality.longText,
    postal_code: componentFor(components, 'postal_code')?.longText ?? '',
    // The ISO short code, never the display name: the checkout partitions and
    // prices on a two-letter country, and "New Zealand" is not one.
    country: country.shortText ?? country.longText,
  }
}

class PlacesNotConfiguredError extends Error {
  constructor() {
    super('GOOGLE_PLACES_API_KEY is not set')
    this.name = 'PlacesNotConfiguredError'
  }
}

export { PlacesNotConfiguredError }

/**
 * Read at REQUEST time, never at import time: throwing at import would break
 * the build on any deploy that has not set the key yet.
 */
function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new PlacesNotConfiguredError()
  return key
}

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
const DETAILS_URL = 'https://places.googleapis.com/v1/places'

export async function fetchPlaceSuggestions(input: {
  query: string
  sessionToken: string
  countryBias?: string | null
}): Promise<PlaceSuggestion[]> {
  const response = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      // Field mask keeps the response (and the bill) to what we render.
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
    },
    body: JSON.stringify({
      input: input.query,
      sessionToken: input.sessionToken,
      ...(input.countryBias ? { includedRegionCodes: [input.countryBias.toLowerCase()] } : {}),
    }),
  })
  if (!response.ok) throw new Error(`Places autocomplete failed: ${response.status}`)

  const data = (await response.json()) as {
    suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>
  }
  return (data.suggestions ?? []).flatMap((suggestion) => {
    const placeId = suggestion.placePrediction?.placeId
    const label = suggestion.placePrediction?.text?.text
    return placeId && label ? [{ placeId, label }] : []
  })
}

export async function fetchPlaceAddress(input: {
  placeId: string
  sessionToken: string
}): Promise<{ components: PlaceAddressComponents; displayName: string | null }> {
  const url = `${DETAILS_URL}/${encodeURIComponent(input.placeId)}?sessionToken=${encodeURIComponent(input.sessionToken)}`
  const response = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'addressComponents,displayName',
    },
  })
  if (!response.ok) throw new Error(`Places details failed: ${response.status}`)

  const data = (await response.json()) as {
    addressComponents?: PlaceAddressComponents
    displayName?: { text?: string }
  }
  return {
    components: data.addressComponents ?? [],
    displayName: data.displayName?.text ?? null,
  }
}
