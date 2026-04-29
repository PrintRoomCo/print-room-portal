import { PortalEmptyState } from '@/components/ui/PortalEmptyState'

export const dynamic = 'force-dynamic'

export default function ProofsPage() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Proofs</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">Proof archive</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Staff prepare and export production proofs from the staff portal. Customer proof
          approval and archive access stay out of the MVP customer portal.
        </p>
      </div>
      <PortalEmptyState
        title="Proofs are managed by your account team"
        body="Your account manager will send production proofs directly when approval is needed. A self-serve archive can follow after the first invited customers are live."
        actionHref="/shop"
        actionLabel="Back to shop"
      />
    </div>
  )
}
