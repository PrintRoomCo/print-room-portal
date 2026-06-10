'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  orderId: string
}

export function CancelPreOrderButton({ orderId }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    if (!window.confirm('Cancel this pre-order? This cannot be undone.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel-pre-order`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        const msg =
          body.error === 'window_closed'
            ? 'The ordering window has closed — you can no longer cancel.'
            : body.error === 'not_cancellable'
              ? 'This order can no longer be cancelled.'
              : 'Something went wrong. Please try again.'
        setError(msg)
        return
      }
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleCancel}
        disabled={busy}
        className="text-sm font-medium text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
      >
        {busy ? 'Cancelling…' : 'Cancel order'}
      </button>
      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
    </span>
  )
}
