'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useCurrency } from '@/contexts/CurrencyContext'
import { CURRENCY_OPTIONS, type SupportedCurrency } from '@/lib/currency/types'

export function CurrencyPicker() {
  const { currency, setCurrency } = useCurrency()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

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

  // /checkout/review renders billing currency only; a visible picker there is
  // a false affordance, since nothing on the page responds to it (spec D4).
  if (pathname === '/checkout/review') return null

  return (
    <div ref={wrapperRef} className="relative z-30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="menu"
        aria-label="Currency"
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-900 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        <span>{currency}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        role="menu"
        aria-hidden={open ? 'false' : 'true'}
        className={`absolute right-0 top-full z-[80] mt-2 w-44 origin-top-right overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-gray-200/70 transition-all duration-200 ease-out motion-reduce:transition-none ${
          open
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-1 pointer-events-none'
        }`}
      >
        {CURRENCY_OPTIONS.map((c) => {
          const active = c.code === currency
          return (
            <button
              key={c.code}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                setCurrency(c.code as SupportedCurrency)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between px-4 py-3 text-sm transition-colors duration-100 ${
                active
                  ? 'bg-gray-50 text-gray-900 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{c.label}</span>
              {active && <CheckIcon className="h-3 w-3 text-gray-900" />}
            </button>
          )
        })}
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
