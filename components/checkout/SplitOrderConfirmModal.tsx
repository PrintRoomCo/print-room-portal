'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef } from 'react'

interface SplitOrderConfirmModalProps {
  open: boolean
  customerUnitCount: number
  inventoryUnitCount: number
  customerAddress: string
  customerTotal: string
  inventoryTotal: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Confirmation modal shown only on split-order submits (customer + inventory
 * buckets both non-empty). Single-intent submits bypass this and call the
 * existing handler directly. Matches the Radix Dialog pattern used in
 * RequestReorderModal — overlay + centered content + close-on-overlay.
 */
export function SplitOrderConfirmModal({
  open,
  customerUnitCount,
  inventoryUnitCount,
  customerAddress,
  customerTotal,
  inventoryTotal,
  onCancel,
  onConfirm,
}: SplitOrderConfirmModalProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open && previousFocusRef.current == null) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    if (!open) {
      previousFocusRef.current = null
    }
  }, [open])

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
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
            You&rsquo;re about to submit two orders:
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Confirm the split-order submission. Customer-ship and inventory orders are
            priced as separate production runs.
          </Dialog.Description>

          <div className="mt-4 space-y-2 text-sm text-gray-800">
            <p>
              <span aria-hidden="true">&rarr; </span>
              Customer ship: {customerUnitCount} units to {customerAddress} &mdash;{' '}
              {customerTotal}
            </p>
            <p>
              <span aria-hidden="true">&rarr; </span>
              Inventory: {inventoryUnitCount} units to your inventory shelf &mdash;{' '}
              {inventoryTotal}
            </p>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            These are priced as separate production runs. After your account manager
            approves, you&rsquo;ll see two orders in /orders. The inventory order will
            arrive at your premises for your team to count in.
          </p>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-full bg-pr-blue px-4 py-2 text-sm font-medium text-white hover:bg-pr-blue/90"
            >
              Submit both orders
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
