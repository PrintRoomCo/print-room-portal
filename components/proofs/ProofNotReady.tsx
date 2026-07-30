import Link from 'next/link'

/**
 * Generic "proof not available" / 403 panel. Shown for:
 *  - proof not found
 *  - wrong org
 *  - proof has no order_id
 *  - proof not yet staff-approved
 *
 * Copy approved by Jamie 2026-05-13 — must not leak whether the proof exists.
 */
export function ProofNotReady() {
  return (
    <div className="max-w-2xl p-4 md:p-8">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium tracking-wide text-gray-400">Proof</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">Proof not available yet</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Your proof will be ready once our team reviews your order. We&apos;ll email you when
          it&apos;s available.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/past-orders"
            className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90"
          >
            Back to past orders
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    </div>
  )
}
