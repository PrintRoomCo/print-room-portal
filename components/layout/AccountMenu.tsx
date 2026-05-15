'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

// Account dropdown for the top bar's right slot. "My Account" pill on
// desktop, anchored panel with Settings + Sign Out. Signed-out users see
// a "Sign In" link instead (no panel).
export function AccountMenu() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)

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
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-900 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          <span>Account</span>
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          loop
          className="z-[80] w-44 origin-top-right overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-gray-200/70 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Item asChild>
            <Link
              href="/account"
              className="block cursor-pointer px-4 py-3 text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => {
              // Optimistic: close + route immediately; auth listener clears state
              // once signOut resolves on the background.
              setOpen(false)
              router.push('/sign-in')
              void signOut()
            }}
            className="block w-full cursor-pointer px-4 py-3 text-left text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
          >
            Sign Out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 12 12" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4.5l3 3 3-3" />
    </svg>
  )
}
