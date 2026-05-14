'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

// Right-slot top-bar dropdown — Settings (links to /account) + Sign In/Out.
// Replaces the previous "My Account" sidebar entry.
export function AccountMenu() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  async function onSignOut() {
    setOpen(false)
    await signOut()
    router.push('/sign-in')
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="My account menu"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        My Account
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 min-w-[10rem] rounded-xl border border-gray-200 bg-white py-1 shadow-md"
        >
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
          >
            Settings
          </Link>
          {user ? (
            <button
              type="button"
              role="menuitem"
              onClick={onSignOut}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
            >
              Sign Out
            </button>
          ) : (
            <Link
              href="/sign-in"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
            >
              Sign In
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
