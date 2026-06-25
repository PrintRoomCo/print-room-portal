'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ReorderForm } from '@/components/orders/ReorderForm'
import { useCart } from '@/components/cart/useCart'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import type { JobTracker } from '@/lib/job-tracker'

interface ReorderButtonProps {
  tracker: JobTracker
}

const PILL =
  'rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 transition-all duration-150 hover:bg-gray-200 active:scale-[0.98] disabled:opacity-60'

export function ReorderButton({ tracker }: ReorderButtonProps) {
  const { user } = useAuth()
  const { access } = useCompany()
  const cart = useCart()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLegacyModal, setShowLegacyModal] = useState(false)
  const [reorderSuccess, setReorderSuccess] = useState(false)

  const isCatalogueOrder = Boolean(tracker.quote_id)

  // Org-admin only. Staff (renamed `buyer`) are restricted to From-inventory
  // ordering, so they must not re-buy a past order that may contain
  // `made_to_order` (production) lines via EITHER branch (rebuild or legacy
  // modal). Gated on derived `isOrgAdmin`, so the buyer→staff rename does not
  // touch it. Placed AFTER all hooks so the early return never reorders hooks.
  if (!(access?.isOrgAdmin ?? false)) return null

  async function rebuildCart() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reorder/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: tracker.quote_id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not rebuild this order')
      }
      const data: { lines: Array<Parameters<typeof cart.addLine>[0]>; degradedCount: number } =
        await res.json()
      for (const line of data.lines) cart.addLine(line)
      router.push('/cart')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rebuild this order')
      setBusy(false)
    }
  }

  function closeLegacyModal() {
    setShowLegacyModal(false)
    setReorderSuccess(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (isCatalogueOrder) {
            void rebuildCart()
          } else {
            setReorderSuccess(false)
            setShowLegacyModal(true)
          }
        }}
        disabled={busy}
        className={PILL}
      >
        {busy ? 'Rebuilding…' : 'Reorder'}
      </button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-red-600">
          {error}
        </span>
      )}

      {/* Legacy Monday-silo modal — unchanged behaviour, only for orders with no quote_id. */}
      <Dialog.Root
        open={showLegacyModal}
        onOpenChange={(open) => {
          if (!open) closeLegacyModal()
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="glass-modal-backdrop" />
          <Dialog.Content className="glass-modal-content fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <Dialog.Title className="text-xl font-bold text-gray-900">
                  Reorder project
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="text-gray-400 transition-colors hover:text-gray-600"
                    aria-label="Close"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Dialog.Close>
              </div>

              {reorderSuccess ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-gray-700">
                    Once you&apos;ve submitted this information, your account manager will reach out
                    to confirm pricing and send an updated proof for your approval.
                  </p>
                </div>
              ) : user?.email ? (
                <ReorderForm
                  tracker={tracker}
                  userEmail={user.email}
                  onSubmitted={() => {
                    setReorderSuccess(true)
                    setTimeout(closeLegacyModal, 4000)
                  }}
                  onCancel={closeLegacyModal}
                />
              ) : (
                <p className="text-sm text-gray-600">
                  Your session has expired. Please sign in again to submit a reorder.
                </p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
