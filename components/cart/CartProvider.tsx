'use client'

import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import {
  lineSignature,
  recomputeProductTierPrices,
  type CartLine,
  type CartLineFulfilmentType,
  type CartState,
} from '@/lib/cart/types'
import { normalizePersisted } from '@/lib/cart/normalize'
import { summariseCartAdds } from '@/lib/cart/added-toast'

export interface CartApi {
  lines: CartLine[]
  addLine: (line: Omit<CartLine, 'lineId'>) => void
  updateLine: (lineId: string, patch: Partial<CartLine>) => void
  removeLine: (lineId: string) => void
  setShipTo: (lineId: string, storeId: string | null) => void
  setFulfilmentType: (lineId: string, fulfilmentType: CartLineFulfilmentType) => void
  clear: () => void
}

export const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { access } = useCompany()
  const organizationId = access?.companyId ?? null
  const isPreview = access?.isPreview ?? false
  const storageKey = organizationId
    ? `${isPreview ? 'pr-cart-preview' : 'pr-cart'}:${organizationId}`
    : null
  const roleKey = organizationId ? `pr-cart-role:${organizationId}` : null
  const role = access?.role ?? null

  const [state, setState] = useState<CartState>({ lines: [] })
  const [hydrated, setHydrated] = useState(false)

  // Coalesce a burst of addLine() calls (a multi-size PDP add, or a Reorder
  // loop) into a single "added to cart" toast: buffer the payloads and flush
  // one summarised `pr:cart-added` event on the next tick. CartAddedToasts
  // (mounted in PortalShell) renders it.
  const pendingAddsRef = useRef<Array<Omit<CartLine, 'lineId'>>>([])
  const addFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (addFlushRef.current) clearTimeout(addFlushRef.current)
    }
  }, [])
  const imageResolutionKey = state.lines
    .map((line) =>
      [
        line.lineId,
        line.catalogueItemId ?? '',
        line.productId,
        line.variantId,
      ].join(':'),
    )
    .join('|')

  useEffect(() => {
    if (!storageKey) {
      setHydrated(true)
      return
    }
    try {
      // Buyer Roles step 6: if role changed since last visit (e.g. staff
      // flipped org_admin → buyer mid-session), the persisted ship-to ids
      // may now be unreachable. Clear the cart and notify the shell.
      if (roleKey && role) {
        const lastRole = localStorage.getItem(roleKey)
        if (lastRole && lastRole !== role) {
          localStorage.removeItem(storageKey)
          sessionStorage.setItem('pr-cart-role-change-toast', '1')
          window.dispatchEvent(new CustomEvent('pr:cart-role-cleared'))
        }
        localStorage.setItem(roleKey, role)
      }
      const raw = localStorage.getItem(storageKey)
      const persisted = raw ? normalizePersisted(JSON.parse(raw)) : { lines: [] }
      // Hydrate stale carts onto the new tier rule. If a line was added
      // pre-recompute (e.g. before this deploy) and now has a wrong unitPrice
      // for its product-total qty, bring it back into agreement.
      setState({ lines: recomputeProductTierPrices(persisted.lines) })
    } catch {
      setState({ lines: [] })
    }
    setHydrated(true)
  }, [storageKey, roleKey, role])

  useEffect(() => {
    if (!hydrated || !storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // quota exceeded or storage unavailable — ignore, cart survives in memory
    }
  }, [state, storageKey, hydrated])

  useEffect(() => {
    if (!hydrated || isPreview || state.lines.length === 0) return

    const lines = state.lines.map((line) => ({
      lineId: line.lineId,
      catalogueItemId: line.catalogueItemId ?? null,
      productId: line.productId,
      variantId: line.variantId || null,
    }))
    let cancelled = false

    fetch('/api/checkout/review-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { imagesByLineId?: Record<string, string> } | null) => {
        if (cancelled) return
        const imagesByLineId = data?.imagesByLineId ?? {}
        setState((current) => {
          let changed = false
          const next = current.lines.map((line) => {
            const imageUrl = imagesByLineId[line.lineId]
            if (!imageUrl || line.imageUrl === imageUrl) return line
            changed = true
            return { ...line, imageUrl }
          })
          return changed ? { lines: next } : current
        })
      })
      .catch(() => {
        // Non-blocking cosmetic hydration; keep the persisted image if lookup fails.
      })

    return () => {
      cancelled = true
    }
  }, [hydrated, imageResolutionKey, isPreview])

  function queueAddedToast(line: Omit<CartLine, 'lineId'>) {
    if (typeof window === 'undefined') return
    pendingAddsRef.current.push(line)
    if (addFlushRef.current != null) return
    addFlushRef.current = setTimeout(() => {
      addFlushRef.current = null
      const adds = pendingAddsRef.current
      pendingAddsRef.current = []
      const summary = summariseCartAdds(adds)
      if (summary) {
        window.dispatchEvent(new CustomEvent('pr:cart-added', { detail: summary }))
      }
    }, 60)
  }

  const api: CartApi = {
    lines: state.lines,
    addLine: (line) => {
      setState((s) => {
        const incomingSig = lineSignature(
          line.productId,
          line.variantId,
          line.variantLabel,
          line.decorations ?? [],
          line.fulfilmentType,
          line.catalogueItemId ?? null,
          line.sizeId ?? null,
          line.locationLabel ?? null,
          line.customName ?? null,
        )
        const existing = s.lines.find(
          (l) =>
            lineSignature(
              l.productId,
              l.variantId,
              l.variantLabel,
              l.decorations,
              l.fulfilmentType,
              l.catalogueItemId ?? null,
              l.sizeId ?? null,
              l.locationLabel ?? null,
              l.customName ?? null,
            ) ===
            incomingSig,
        )
        const merged: CartLine[] = existing
          ? s.lines.map((l) =>
              // Refresh brackets AND decoration brackets from the incoming
              // add — the new PDP fetch is the latest source of truth — and
              // let recomputeProductTierPrices below settle unitPrice across
              // every same-product line at the new total qty. The signature
              // match guarantees the decoration set is identical, so we can
              // safely swap in the incoming decoration payload (which carries
              // the latest qty-band ladder snapshot).
              l === existing
                ? {
                    ...l,
                    qty: l.qty + line.qty,
                    brackets: line.brackets ?? l.brackets,
                    decorations:
                      line.decorations && line.decorations.length > 0
                        ? line.decorations
                        : l.decorations,
                    // Manual-final: refresh the line-level combined decoration +
                    // its ladder from the incoming add (same "latest source of
                    // truth" rule as brackets); recompute settles it at new qty.
                    manualDecorationPerUnit:
                      line.manualDecorationPerUnit ?? l.manualDecorationPerUnit,
                    manualDecorationBrackets:
                      line.manualDecorationBrackets ?? l.manualDecorationBrackets,
                  }
                : l,
            )
          : [
              ...s.lines,
              {
                ...line,
                decorations: line.decorations ?? [],
                lineId: crypto.randomUUID(),
              },
            ]
        return { lines: recomputeProductTierPrices(merged) }
      })
      queueAddedToast(line)
    },
    updateLine: (lineId, patch) =>
      setState((s) => {
        const next = s.lines.map((l) =>
          l.lineId === lineId ? { ...l, ...patch } : l,
        )
        return { lines: recomputeProductTierPrices(next) }
      }),
    removeLine: (lineId) =>
      setState((s) => ({
        lines: recomputeProductTierPrices(s.lines.filter((l) => l.lineId !== lineId)),
      })),
    setShipTo: (lineId, storeId) =>
      setState((s) => ({
        lines: s.lines.map((l) =>
          l.lineId === lineId ? { ...l, shipToStoreId: storeId } : l
        ),
      })),
    // fulfilmentType is NOT part of the tier aggregation key, so flipping it
    // never re-pools pricing — a plain field update, mirroring setShipTo.
    setFulfilmentType: (lineId, fulfilmentType) =>
      setState((s) => ({
        lines: s.lines.map((l) =>
          l.lineId === lineId ? { ...l, fulfilmentType } : l
        ),
      })),
    clear: () => setState({ lines: [] }),
  }

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>
}
