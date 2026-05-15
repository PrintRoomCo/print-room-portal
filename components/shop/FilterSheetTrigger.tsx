'use client'

import { useState, useEffect } from 'react'

interface Props {
  activeCount: number
  children: React.ReactNode
}

export function FilterSheetTrigger({ activeCount, children }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-900 transition-all duration-150 hover:bg-gray-200 active:scale-[0.98] md:hidden"
      >
        <FilterIcon className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white tabular-nums">
            {activeCount}
          </span>
        )}
      </button>

      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close filters"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-label="Filters"
        aria-hidden={!open}
        className={`fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl transition-transform duration-300 ease-out md:hidden ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-gray-900">Filters</h2>
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-all duration-150 hover:bg-gray-200 active:scale-[0.98]"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M3 4h18M6 12h12M10 20h4"
      />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
