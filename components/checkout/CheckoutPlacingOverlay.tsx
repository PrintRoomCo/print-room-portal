'use client'

import { AnimatePresence, motion } from 'framer-motion'

/**
 * Full-screen "placing your order" overlay. Rendered above the checkout review
 * page while a submit is in flight so the page never looks frozen, and stays up
 * through the redirect to the confirmation page (masking the emptied cart).
 */
export function CheckoutPlacingOverlay({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="checkout-placing-overlay"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white/85 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex max-w-xs flex-col items-center gap-4 text-center"
          >
            <svg className="h-8 w-8 animate-spin text-gray-900" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm font-medium text-gray-900">Placing your order…</p>
            <p className="text-xs text-gray-500">
              Reserving stock and confirming pricing — this can take a moment for large orders.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
