'use client'

import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { decorationSignature, type CartLine, type CartState } from '@/lib/cart/types'

export interface CartApi {
  lines: CartLine[]
  addLine: (line: Omit<CartLine, 'lineId'>) => void
  updateLine: (lineId: string, patch: Partial<CartLine>) => void
  removeLine: (lineId: string) => void
  setShipTo: (lineId: string, storeId: string | null) => void
  clear: () => void
}

export const CartContext = createContext<CartApi | null>(null)

function normalizePersisted(raw: unknown): CartState {
  if (!raw || typeof raw !== 'object') return { lines: [] }
  const lines = (raw as { lines?: unknown }).lines
  if (!Array.isArray(lines)) return { lines: [] }
  const normalized: CartLine[] = []
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue
    const l = line as Partial<CartLine> & Record<string, unknown>
    if (typeof l.lineId !== 'string' || typeof l.productId !== 'string') continue
    normalized.push({
      lineId: l.lineId,
      productId: l.productId,
      productName: typeof l.productName === 'string' ? l.productName : '',
      variantId: typeof l.variantId === 'string' ? l.variantId : '',
      variantLabel: typeof l.variantLabel === 'string' ? l.variantLabel : '—',
      qty: typeof l.qty === 'number' && l.qty > 0 ? l.qty : 1,
      unitPrice: typeof l.unitPrice === 'number' ? l.unitPrice : 0,
      imageUrl: typeof l.imageUrl === 'string' ? l.imageUrl : null,
      shipToStoreId:
        typeof l.shipToStoreId === 'string' || l.shipToStoreId === null
          ? (l.shipToStoreId ?? null)
          : null,
      decorations: Array.isArray(l.decorations) ? l.decorations : [],
    })
  }
  return { lines: normalized }
}

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
      setState(raw ? normalizePersisted(JSON.parse(raw)) : { lines: [] })
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
        const incomingSig = decorationSignature(line.decorations ?? [])
        const existing = s.lines.find(
          (l) =>
            l.productId === line.productId &&
            l.variantId === line.variantId &&
            decorationSignature(l.decorations) === incomingSig,
        )
        if (existing) {
          return {
            lines: s.lines.map((l) =>
              l === existing ? { ...l, qty: l.qty + line.qty } : l
            ),
          }
        }
        return {
          lines: [
            ...s.lines,
            {
              ...line,
              decorations: line.decorations ?? [],
              lineId: crypto.randomUUID(),
            },
          ],
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
