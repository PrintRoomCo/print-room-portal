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
      // When present, the top bar grows a second row hosting filter controls.
      filters?: ShopFilters
      facets?: ShopFacets
      // The form's GET action — defaults to the current pathname if omitted.
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

export function usePortalDrawer() {
  const ctx = useContext(Ctx)
  return {
    open: ctx?.drawerOpen ?? false,
    setOpen: ctx?.setDrawerOpen ?? (() => {}),
    toggle: () => ctx?.setDrawerOpen(!(ctx?.drawerOpen ?? false)),
  }
}

// Declarative helper — drop into a server component's JSX to set the bar
// context for the lifetime of that page. Clears on unmount.
export function SetTopBarContext({ value }: { value: PortalTopBarContextValue }) {
  const setValue = useSetTopBarContext()
  useEffect(() => {
    setValue(value)
    return () => setValue(null)
    // Compare by serialized shape so server-rendered identical values don't
    // thrash the setter on every render.
  }, [setValue, JSON.stringify(value)])
  return null
}
