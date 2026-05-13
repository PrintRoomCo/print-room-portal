import Link from 'next/link'
import type { VisibleProofRow } from '@/lib/proofs/visibility'

interface ProofArchiveCardProps {
  proof: VisibleProofRow
}

export function ProofArchiveCard({ proof }: ProofArchiveCardProps) {
  const orderRef = proof.orderRef ?? 'Order proof'
  const designLabel = proof.designCount === 1 ? '1 design' : `${proof.designCount} designs`

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="aspect-[4/3] overflow-hidden bg-gray-50">
        {proof.mockupUrl ? (
          <img
            src={proof.mockupUrl}
            alt={`${orderRef} proof mockup`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gray-50 text-sm font-medium text-gray-400">
            Proof
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold text-gray-900">{orderRef}</p>
            <h2 className="mt-1 line-clamp-2 text-base font-semibold text-gray-900">
              {proof.name}
            </h2>
          </div>
          <span className="shrink-0 rounded-full bg-lime-50 px-2.5 py-1 text-xs font-medium text-lime-800">
            Awaiting review
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-600">
          <span className="rounded-full bg-gray-100 px-2.5 py-1">{designLabel}</span>
          <span className="rounded-full bg-gray-100 px-2.5 py-1">{formatSentAt(proof.sentAt)}</span>
        </div>

        <div className="mt-auto pt-5">
          {proof.orderId ? (
            <Link
              href={`/orders/${proof.orderId}/proof`}
              className="inline-flex items-center rounded-full bg-pr-blue px-4 py-2 text-sm font-medium text-white hover:bg-pr-blue/90"
            >
              View proof
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function formatSentAt(value: string | null) {
  if (!value) return 'Sent recently'

  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Sent recently'

  const days = Math.floor((Date.now() - time) / 86_400_000)
  if (days <= 0) return 'Sent today'
  if (days === 1) return 'Sent yesterday'
  return `Sent ${days} days ago`
}
