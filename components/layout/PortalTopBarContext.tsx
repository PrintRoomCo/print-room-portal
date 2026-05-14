'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

// Declarative helper — drop into a server component's JSX to set the bar
// context for the lifetime of that page. Clears on unmount. The PortalTopBar
// currently only renders the 'listing' kind (catalogue filter row); other
// kinds set the value harmlessly and can be cleaned up later.
export function SetTopBarContext({ value }: { value: PortalTopBarContextValue }) {
  const setValue = useSetTopBarContext()
  useEffect(() => {
    setValue(value)
    return () => setValue(null)
    // Compare by serialized shape so server-rendered identical values don't
    // thrash the setter on every render.
  }, [setValue, JSON.stringify(value)]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
