'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import { useCompany } from '@/contexts/CompanyContext'

interface RequestReorderModalProps {
  variantId: string
  variantLabel: string
  productName: string
  defaultQty: number
  onClose: () => void
  onSuccess: () => void
}

export function RequestReorderModal({
  variantId,
  variantLabel,
  productName,
  defaultQty,
  onClose,
  onSuccess,
}: RequestReorderModalProps) {
  const [qty, setQty] = useState(defaultQty)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const { access } = useCompany()
  const isPreview = access?.isPreview ?? false

  useEffect(() => {
    if (previousFocusRef.current == null) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [])

  async function handleSubmit() {
    if (isPreview) return // read-only preview — never POST
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Quantity must be a positive whole number.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout/reorder-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_id: variantId, requested_qty: qty, note: note || undefined }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }
      onSuccess()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl"
          onCloseAutoFocus={(event) => {
            if (!previousFocusRef.current) return
            event.preventDefault()
            previousFocusRef.current.focus()
          }}
        >
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Request reorder
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600">
            {productName} — {variantLabel}
          </Dialog.Description>
          <p className="mt-3 text-sm text-gray-500">
            This alerts our staff that you'd like more stock of this variant.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="reorder-qty" className="block text-sm font-medium text-gray-700">
                Quantity
              </label>
              <input
                id="reorder-qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30"
              />
            </div>

            <div>
              <label htmlFor="reorder-note" className="block text-sm font-medium text-gray-700">
                Note (optional)
              </label>
              <textarea
                id="reorder-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything we should know — e.g. required by date"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30"
              />
            </div>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={submitting}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || isPreview}
              className="rounded-full bg-pr-blue px-4 py-2 text-sm font-medium text-white hover:bg-pr-blue/90 disabled:opacity-50"
            >
              {isPreview ? 'Preview only' : submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
