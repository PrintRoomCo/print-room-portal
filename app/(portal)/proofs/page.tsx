import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { ProofArchiveCard } from '@/components/proofs/ProofArchiveCard'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { listVisibleProofsForOrg } from '@/lib/proofs/visibility'

export const dynamic = 'force-dynamic'

export default async function ProofsPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)

  const { admin, context } = auth
  const proofs = await listVisibleProofsForOrg(admin, context.organizationId)

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Proofs</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">Proof archive</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          {proofs.length === 1
            ? '1 proof ready for review.'
            : `${proofs.length} proofs ready for review.`}
        </p>
      </div>

      {proofs.length === 0 ? (
        <PortalEmptyState
          title="No proofs ready yet"
          body="Your account manager will send proofs here once they're ready for your approval. Each one will appear with a mockup and a link to review and approve."
          actionHref="/order-tracker"
          actionLabel="View your orders"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {proofs.map((proof) => (
            <ProofArchiveCard key={proof.id} proof={proof} />
          ))}
        </div>
      )}
    </div>
  )
}
