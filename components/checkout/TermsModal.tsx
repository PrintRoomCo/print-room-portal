'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef } from 'react'
import { TermsContent } from './TermsContent'

interface TermsModalProps {
  /** AU Stage 1 — org billing region; drives the currency sentence in §1. */
  region?: 'NZ' | 'AU'
  onClose: () => void
}

export function TermsModal({ onClose, region = 'NZ' }: TermsModalProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (previousFocusRef.current == null) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [])

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          onCloseAutoFocus={(event) => {
            if (!previousFocusRef.current) return
            event.preventDefault()
            previousFocusRef.current.focus()
          }}
        >
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Terms &amp; Conditions
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600">
            Please read these terms. You agree to them when you place your order.
          </Dialog.Description>

          <div className="mt-4">
            <TermsContent region={region} />
          </div>

          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full bg-pr-blue px-4 py-2 text-sm font-medium text-white hover:bg-pr-blue/90"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
