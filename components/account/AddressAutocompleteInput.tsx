'use client'

import {
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  fetchGeoapifySuggestions,
  getSuggestionLabel,
  parseSuggestion,
  MIN_QUERY_LENGTH,
  type AddressPlace,
  type GeoapifySuggestion,
} from '@/lib/address/geoapify'

export type { AddressPlace }

interface AddressAutocompleteInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  onPlace: (place: AddressPlace) => void
}

let missingKeyLogged = false

export function AddressAutocompleteInput({
  value,
  onChange,
  onPlace,
  onFocus,
  onBlur,
  className,
  ...props
}: AddressAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectedValueRef = useRef<string | null>(null)
  const [suggestions, setSuggestions] = useState<GeoapifySuggestion[]>([])
  const [open, setOpen] = useState(false)
  const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY?.trim()
  const inputClassName = className ?? 'input-glass'

  useEffect(() => {
    if (!apiKey && !missingKeyLogged) {
      console.info('Geoapify API key missing; using plain address input.')
      missingKeyLogged = true
    }
  }, [apiKey])

  useEffect(() => {
    const query = value.trim()

    if (!apiKey || query.length < MIN_QUERY_LENGTH || selectedValueRef.current === value) {
      setSuggestions([])
      setOpen(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      fetchGeoapifySuggestions(query, apiKey, controller.signal)
        .then((nextSuggestions) => {
          setSuggestions(nextSuggestions)
          setOpen(
            nextSuggestions.length > 0 &&
              document.activeElement === inputRef.current,
          )
        })
        .catch((error) => {
          if ((error as Error).name !== 'AbortError') {
            setSuggestions([])
            setOpen(false)
          }
        })
    }, 250)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [apiKey, value])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    selectedValueRef.current = null
    onChange(event.target.value)
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    onFocus?.(event)
    if (suggestions.length > 0) setOpen(true)
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    onBlur?.(event)
    window.setTimeout(() => setOpen(false), 100)
  }

  function selectSuggestion(suggestion: GeoapifySuggestion) {
    const place = parseSuggestion(suggestion)
    const nextAddress = place.address ?? getSuggestionLabel(suggestion)
    selectedValueRef.current = nextAddress
    onChange(nextAddress)
    onPlace({ ...place, address: nextAddress })
    setSuggestions([])
    setOpen(false)
  }

  if (!apiKey) {
    return (
      <input
        {...props}
        ref={inputRef}
        className={inputClassName}
        value={value}
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    )
  }

  return (
    <div className="relative">
      <input
        {...props}
        ref={inputRef}
        className={inputClassName}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg"
          role="listbox"
        >
          {suggestions.map((suggestion) => {
            const label = getSuggestionLabel(suggestion)

            return (
              <li key={suggestion.place_id ?? label} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
