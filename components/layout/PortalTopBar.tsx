'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'
import { usePortalDrawer } from './PortalTopBarContext'
import { CurrencyPicker } from './CurrencyPicker'
import { TopBarCartPill } from './TopBarCartPill'
import { AccountMenu } from './AccountMenu'

export function PortalTopBar() {
  const drawer = usePortalDrawer()

  // Publish total bar height as a CSS variable so Sidebar's main content can
  // offset its top padding. 76px = 12px inset + 56px pill + 8px gap.
  useEffect(() => {
    document.documentElement.style.setProperty('--portal-topbar-h', '76px')
  }, [])

  return (
    <header
      role="banner"
      className="fixed inset-x-3 top-3 z-30 rounded-2xl bg-white"
    >
      <div className="flex h-14 items-center px-3 md:px-4">
        {/* Menu trigger — toggles the Sidebar drawer */}
        <button
          type="button"
          onClick={drawer.toggle}
          aria-label="Open navigation menu"
          aria-expanded={drawer.open}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200"
        >
          <MenuIcon className="h-4 w-4" />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Centre: brand mark only, no wordmark */}
        <Link
          href="/account"
          aria-label="The Print Room"
          className="flex shrink-0 items-center"
        >
          <Image
            src="/print-room-logo.png"
            alt=""
            width={28}
            height={28}
            priority
            className="h-7 w-7 object-contain"
          />
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: cart + currency + account */}
        <div className="flex shrink-0 items-center gap-2">
          <TopBarCartPill />
          <CurrencyPicker />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  )
}
