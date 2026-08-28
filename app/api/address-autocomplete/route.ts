import { NextResponse } from 'next/server'

import {
  PlacesNotConfiguredError,
  fetchPlaceAddress,
  fetchPlaceSuggestions,
  mapPlaceToCustomAddress,
} from '@/lib/address/places'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

/** Below this a query is mostly noise, and every keystroke is billable. */
const MIN_QUERY_LENGTH = 4

interface AutocompleteBody {
  query?: unknown
  placeId?: unknown
  sessionToken?: unknown
  countryBias?: unknown
  name?: unknown
}

/**
 * Server proxy for Google Places (New). The API key is held here and never
 * reaches the browser, which is a stronger guarantee than referrer-restricting
 * a key in the bundle.
 *
 * Two modes on one route: `{ query }` lists suggestions, `{ placeId }` resolves
 * one to a structured address. Both carry the same sessionToken so Google bills
 * the pair as a single session rather than per keystroke.
 */
export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  let body: AutocompleteBody
  try {
    body = (await request.json()) as AutocompleteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : ''
  if (!sessionToken) {
    return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 })
  }

  try {
    if (typeof body.placeId === 'string' && body.placeId !== '') {
      const { components, displayName } = await fetchPlaceAddress({
        placeId: body.placeId,
        sessionToken,
      })
      const fallbackName = typeof body.name === 'string' && body.name.trim() !== ''
        ? body.name.trim()
        : displayName ?? ''
      const address = mapPlaceToCustomAddress(components, fallbackName)
      if (!address) {
        return NextResponse.json(
          {
            error: 'That result has no street address. Pick a more specific place, or enter it manually.',
            code: 'place_not_shippable',
          },
          { status: 422 },
        )
      }
      return NextResponse.json({ address })
    }

    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (query.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ suggestions: [] })
    }

    const suggestions = await fetchPlaceSuggestions({
      query,
      sessionToken,
      countryBias: typeof body.countryBias === 'string' ? body.countryBias : null,
    })
    return NextResponse.json({ suggestions })
  } catch (error) {
    if (error instanceof PlacesNotConfiguredError) {
      // 503, not 500: address lookup is unavailable but checkout is not broken.
      // The client falls back to the manual fields.
      return NextResponse.json(
        { error: 'Address lookup is unavailable.', code: 'places_unconfigured' },
        { status: 503 },
      )
    }
    console.error('[address-autocomplete] lookup failed', error)
    return NextResponse.json(
      { error: 'Address lookup failed.', code: 'places_failed' },
      { status: 502 },
    )
  }
}
