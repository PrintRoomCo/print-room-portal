'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

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
}

const Ctx = createContext<InternalCtx | null>(null)

export function PortalTopBarProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<PortalTopBarContextValue | null>(null)
  const contextValue = useMemo(() => ({ value, setValue }), [value])
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
