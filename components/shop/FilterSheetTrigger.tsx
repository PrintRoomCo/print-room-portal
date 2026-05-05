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
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden rounded-full border border-gray-200 bg-white px-4 py-2 text-sm shadow-sm"
      >
        Filters{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex bg-black/40 md:hidden">
          <div className="ml-auto h-full w-full max-w-sm overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Filters</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  )
}
