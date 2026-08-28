'use client'

import { useEffect, useRef, useState } from 'react'

import type { CustomAddress } from './checkoutReviewState'

interface Suggestion {
  placeId: string
  label: string
}

interface AddressAutocompleteInputProps {
  /** Name to carry onto the resolved address (the site/contact name). */
  name: string
  countryBias?: string | null
  onResolved: (address: CustomAddress) => void
  /** Reveals the caller's manual fields. Google being down must never block checkout. */
  onManualEntry: () => void
  disabled?: boolean
}

const DEBOUNCE_MS = 300

export function AddressAutocompleteInput({
  name,
  countryBias = null,
  onResolved,
  onManualEntry,
  disabled = false,
}: AddressAutocompleteInputProps) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // One token per input session, sent with BOTH the autocomplete calls and the
  // final details call, so Google bills the whole lookup as one session rather
  // than charging per keystroke.
  const sessionTokenRef = useRef<string>('')
  if (sessionTokenRef.current === '') sessionTokenRef.current = crypto.randomUUID()

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 4) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/address-autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            query: trimmed,
            sessionToken: sessionTokenRef.current,
            countryBias,
          }),
        })
        if (!response.ok) {
          setSuggestions([])
          setError(
            response.status === 503
              ? 'Address lookup is unavailable. Enter the address manually.'
              : 'Could not search addresses. Enter the address manually.',
          )
          return
        }
        const data = (await response.json()) as { suggestions?: Suggestion[] }
        setSuggestions(data.suggestions ?? [])
        setError(null)
      } catch (fetchError) {
        if ((fetchError as Error).name !== 'AbortError') {
          setSuggestions([])
          setError('Could not search addresses. Enter the address manually.')
        }
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, countryBias])

  async function pick(suggestion: Suggestion) {
    setLoading(true)
    try {
      const response = await fetch('/api/address-autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeId: suggestion.placeId,
          sessionToken: sessionTokenRef.current,
          name,
        }),
      })
      const data = (await response.json()) as { address?: CustomAddress; error?: string }
      if (!response.ok || !data.address) {
        setError(data.error ?? 'Could not use that address. Enter it manually.')
        return
      }
      onResolved(data.address)
      setSuggestions([])
      setQuery(suggestion.label)
      // A new token for the next lookup: this session is now spent.
      sessionTokenRef.current = crypto.randomUUID()
      setError(null)
    } catch {
      setError('Could not use that address. Enter it manually.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">Search for an address</span>
        <input
          type="text"
          aria-label="Search for an address"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          placeholder="Start typing a street address"
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30 disabled:bg-gray-100"
        />
      </label>

      {loading && <p className="text-xs text-gray-500">Searching…</p>}

      {suggestions.length > 0 && (
        <ul className="rounded-lg border border-gray-100 bg-white text-sm">
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId}>
              <button
                type="button"
                onClick={() => pick(suggestion)}
                disabled={disabled}
                className="block w-full px-3 py-2 text-left hover:bg-gray-50"
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-amber-700">{error}</p>}

      <button
        type="button"
        onClick={onManualEntry}
        className="self-start text-xs text-gray-500 underline hover:text-gray-900"
      >
        Can&apos;t find it? Enter the address manually
      </button>
    </div>
  )
}
