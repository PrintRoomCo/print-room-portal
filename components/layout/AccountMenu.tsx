'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

// Account dropdown for the top bar's right slot. "My Account" pill on
// desktop, anchored panel with Settings + Sign Out. Signed-out users see
// a "Sign In" link instead (no panel).
export function AccountMenu() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

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

  if (!user) {
    return (
      <Link
        href="/sign-in"
        className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-900 transition-colors hover:bg-gray-200"
      >
        Sign In
      </Link>
    )
  }

  return (
    <div ref={wrapperRef} className="relative z-30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-900 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        <span>Account</span>
        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`} />
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
        <Link
          href="/account"
          role="menuitem"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
          className="block px-4 py-3 text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50"
        >
          Settings
        </Link>
        <button
          type="button"
          role="menuitem"
          tabIndex={open ? 0 : -1}
          onClick={() => {
            // Optimistic: close + route immediately; auth listener clears state
            // once signOut resolves on the background.
            setOpen(false)
            router.push('/sign-in')
            void signOut()
          }}
          className="block w-full px-4 py-3 text-left text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50"
        >
          Sign Out
        </button>
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
