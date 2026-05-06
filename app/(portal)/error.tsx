'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[portal] unhandled error', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-600">
          We hit an unexpected error loading this page.
          {error.digest ? ` Reference: ${error.digest}.` : ''} Please try again, or contact{' '}
          <a className="underline" href="mailto:sales@theprint-room.co.nz">
            sales@theprint-room.co.nz
          </a>{' '}
          if it keeps happening.
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90"
          >
            Try again
          </button>
          <Link
            href="/account"
            className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Back to account
          </Link>
        </div>
      </div>
    </div>
  )
}
