'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { ShopFilters } from '@/lib/shop/filter-params'
import type { ShopFacets } from '@/lib/shop/facets'

// Per-page context shown in the global top bar's left summary block.
// Pages set this from their server component via <SetTopBarContext />, or
// from a child client component via useSetTopBarContext().
export type PortalTopBarContextValue =
  | { kind: 'section'; label: string }
  | {
      kind: 'listing'
      label: string
      count: number
      page?: number
      pageCount?: number
      // Optional: when present, the top bar grows a second row hosting the
      // filter form. Used by the catalogue listing so the grid renders
      // full-width below.
      filters?: ShopFilters
      facets?: ShopFacets
      filterAction?: string
    }
  | {
      kind: 'pdp'
      productName: string
      type: string | null
      priceLabel: string | null
    }

interface InternalCtx {
  value: PortalTopBarContextValue | null
  setValue: (v: PortalTopBarContextValue | null) => void
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
}

const Ctx = createContext<InternalCtx | null>(null)

export function PortalTopBarProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<PortalTopBarContextValue | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const contextValue = useMemo(
    () => ({ value, setValue, drawerOpen, setDrawerOpen }),
    [value, drawerOpen],
  )
  return <Ctx.Provider value={contextValue}>{children}</Ctx.Provider>
}

export function useTopBarContextValue(): PortalTopBarContextValue | null {
  const ctx = useContext(Ctx)
  return ctx?.value ?? null
}

export function useSetTopBarContext() {
  const ctx = useContext(Ctx)
  return useCallback(
    (v: PortalTopBarContextValue | null) => {
      ctx?.setValue(v)
    },
    [ctx],
  )
}

// Drawer state lives in the top bar provider so the Menu button (mounted in
// PortalTopBar) and the Sidebar drawer (mounted in PortalShell) share it.
export function usePortalDrawer() {
  const ctx = useContext(Ctx)
  const open = ctx?.drawerOpen ?? false
  return useMemo(
    () => ({
      open,
      setOpen: (next: boolean) => ctx?.setDrawerOpen(next),
      toggle: () => ctx?.setDrawerOpen(!open),
    }),
    // ctx identity is stable (created once by provider); open changes per toggle
    [ctx, open],
  )
}

/**
 * @deprecated The top bar no longer renders contextual stat blocks.
 * Pages should drop their <SetTopBarContext> calls — see
 * ~/.claude/plans/2026-05-15-oem-care-portal-sweep.md (Phase D).
 * This component is a no-op kept for transitional safety so existing
 * callers compile until Phase D ships.
 */
export function SetTopBarContext({ value }: { value: PortalTopBarContextValue }) {
  void value
  return null
}
