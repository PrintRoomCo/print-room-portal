'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface Option {
  value: string
  label: string
}

interface Props {
  name: string
  defaultValue: string
  options: Option[]
  ariaLabel: string
}

export function FilterAutoSubmitSelect({
  name,
  defaultValue,
  options,
  ariaLabel,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const currentLabel =
    options.find((o) => o.value === value)?.label ?? options[0]?.label ?? ''

  function selectOption(v: string) {
    setOpen(false)
    if (v === value) return
    setValue(v)

    const params = new URLSearchParams(searchParams.toString())
    if (v) {
      params.set(name, v)
    } else {
      params.delete(name)
    }
    params.set('page', '1')
    const query = params.toString()
    const nextUrl = query ? `${pathname}?${query}` : pathname
    startTransition(() => router.push(nextUrl, { scroll: false }))
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-busy={isPending ? 'true' : 'false'}
        className={`inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 transition-all duration-150 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 active:scale-[0.98] ${
          isPending ? 'opacity-60' : ''
        }`}
      >
        <span className="max-w-[12rem] truncate">{currentLabel}</span>
        {isPending && (
          <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse" />
        )}
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        role="listbox"
        aria-label={ariaLabel}
        aria-hidden={open ? 'false' : 'true'}
        className={`absolute left-0 top-full z-[80] mt-2 w-56 origin-top-left overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-gray-200/70 transition-all duration-200 ease-out motion-reduce:transition-none ${
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-1 opacity-0'
        }`}
      >
        <div className="max-h-80 overflow-y-auto">
          {options.map((o) => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active ? 'true' : 'false'}
                tabIndex={open ? 0 : -1}
                onClick={() => selectOption(o.value)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors duration-100 ${
                  active
                    ? 'bg-gray-50 font-medium text-gray-900'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {active && (
                  <CheckIcon className="h-3 w-3 shrink-0 text-gray-900" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 12 12" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4.5l3 3 3-3" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 12 12" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 6.5L5 9.5L10 3.5" />
    </svg>
  )
}
