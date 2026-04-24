'use client'

import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import type { CartLine, CartState } from '@/lib/cart/types'

export interface CartApi {
  lines: CartLine[]
  addLine: (line: Omit<CartLine, 'lineId'>) => void
  updateLine: (lineId: string, patch: Partial<CartLine>) => void
  removeLine: (lineId: string) => void
  setShipTo: (lineId: string, storeId: string | null) => void
  clear: () => void
}

export const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { access } = useCompany()
  const organizationId = access?.companyId ?? null
  const storageKey = organizationId ? `pr-cart:${organizationId}` : null

  const [state, setState] = useState<CartState>({ lines: [] })
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!storageKey) {
      setHydrated(true)
      return
    }
    try {
      const raw = localStorage.getItem(storageKey)
      setState(raw ? (JSON.parse(raw) as CartState) : { lines: [] })
    } catch {
      setState({ lines: [] })
    }
    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!hydrated || !storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // quota exceeded or storage unavailable — ignore, cart survives in memory
    }
  }, [state, storageKey, hydrated])

  const api: CartApi = {
    lines: state.lines,
    addLine: (line) =>
      setState((s) => {
        const existing = s.lines.find(
          (l) => l.productId === line.productId && l.variantId === line.variantId
        )
        if (existing) {
          return {
            lines: s.lines.map((l) =>
              l === existing ? { ...l, qty: l.qty + line.qty } : l
            ),
          }
        }
        return {
          lines: [...s.lines, { ...line, lineId: crypto.randomUUID() }],
        }
      }),
    updateLine: (lineId, patch) =>
      setState((s) => ({
        lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)),
      })),
    removeLine: (lineId) =>
      setState((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) })),
    setShipTo: (lineId, storeId) =>
      setState((s) => ({
        lines: s.lines.map((l) =>
          l.lineId === lineId ? { ...l, shipToStoreId: storeId } : l
        ),
      })),
    clear: () => setState({ lines: [] }),
  }

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>
}
