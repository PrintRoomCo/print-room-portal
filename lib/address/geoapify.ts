// Geoapify autocomplete plumbing — per-repo copy of the pure parts of the
// staff portal's AddressAutocompleteInput (repos share no packages).

export interface AddressPlace {
  address?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
}

export interface GeoapifySuggestion {
  formatted?: string
  address_line1?: string
  address_line2?: string
  housenumber?: string
  street?: string
  city?: string
  town?: string
  village?: string
  suburb?: string
  county?: string
  state?: string
  state_code?: string
  postcode?: string
  country_code?: string
  place_id?: string
}

interface GeoapifyAutocompleteResponse {
  results?: GeoapifySuggestion[]
}

export const MIN_QUERY_LENGTH = 3
const MAX_SUGGESTIONS = 5

export function getSuggestionLabel(suggestion: GeoapifySuggestion) {
  return (
    suggestion.formatted ??
    [suggestion.address_line1, suggestion.address_line2].filter(Boolean).join(', ')
  )
}

export function getStreetAddress(suggestion: GeoapifySuggestion) {
  const streetAddress = [suggestion.housenumber, suggestion.street]
    .filter(Boolean)
    .join(' ')

  return suggestion.address_line1 || streetAddress || suggestion.formatted || ''
}

export function parseSuggestion(suggestion: GeoapifySuggestion): AddressPlace {
  return {
    address: getStreetAddress(suggestion),
    city:
      suggestion.city ??
      suggestion.town ??
      suggestion.village ??
      suggestion.suburb ??
      suggestion.county,
    state: suggestion.state_code ?? suggestion.state,
    postal_code: suggestion.postcode,
    country: suggestion.country_code?.toUpperCase(),
  }
}

export async function fetchGeoapifySuggestions(
  query: string,
  apiKey: string,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    text: query,
    format: 'json',
    lang: 'en',
    limit: String(MAX_SUGGESTIONS),
    apiKey,
  })

  const response = await fetch(
    `https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`,
    { signal },
  )

  if (!response.ok) {
    throw new Error(`Geoapify autocomplete failed (${response.status})`)
  }

  const data = (await response.json()) as GeoapifyAutocompleteResponse
  return (data.results ?? []).filter((suggestion) => getSuggestionLabel(suggestion))
}
