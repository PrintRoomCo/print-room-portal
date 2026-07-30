import type { Metadata } from 'next'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { ProofArchiveCard } from '@/components/proofs/ProofArchiveCard'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { listVisibleProofsForOrg } from '@/lib/proofs/visibility'

export const metadata: Metadata = {
  title: 'Proofs',
}

export default async function ProofsPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)

  const { admin, context } = auth
  const proofs = await listVisibleProofsForOrg(admin, context.organizationId)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Proof archive
          </h1>
          <p className="mt-4 max-w-prose text-base text-gray-600">
            {proofs.length === 1
              ? '1 proof ready for review.'
              : `${proofs.length} proofs ready for review.`}
          </p>
        </header>

        {proofs.length === 0 ? (
          <PortalEmptyState
            title="No proofs ready yet"
            body="Your account manager will send proofs here once they're ready for your approval. Each one will appear with a mockup and a link to review and approve."
            actionHref="/current-orders"
            actionLabel="View your orders"
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {proofs.map((proof) => (
              <ProofArchiveCard key={proof.id} proof={proof} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
