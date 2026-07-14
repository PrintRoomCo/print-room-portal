import Link from 'next/link'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { ProofNotReady } from '@/components/proofs/ProofNotReady'
import { ProofViewer } from '@/components/proofs/ProofViewer'
import { coerceProofDocument } from '@/lib/proofs/types'
import { isProofVisibleToCustomer } from '@/lib/proofs/visibility'

const ALLOWED_EDIT_ROLES = new Set(['org_admin', 'staff'])

interface OrderRow {
  id: string
  status: string | null
  order_proof_approval_gate: string | null
  quote_id: string | null
  quotes: { organization_id: string | null } | null
}

interface ProofRow {
  id: string
  organization_id: string
  order_id: string | null
  name: string
  status: string
  proof_quality_status: string
  current_version_id: string | null
}

interface VersionRow {
  id: string
  snapshot_data: unknown
}
export default async function OrderProofPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ amendment?: string }>
}) {
  const { id: orderId } = await params
  const search = (await searchParams) ?? {}
  const amendmentSubmitted = search.amendment === 'submitted'

  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  const { data: orderData } = await admin
    .from('orders')
    .select('id, status, order_proof_approval_gate, quote_id, quotes!inner(organization_id)')
    .eq('id', orderId)
    .maybeSingle()
  const order = orderData as unknown as OrderRow | null

  if (!order || !order.quotes) return <ProofNotReady />


  if (order.quotes.organization_id !== context.organizationId) {
    console.warn('[proof-viewer] org_mismatch', {
      orderId,
      userId: context.userId,
      callerOrgId: context.organizationId,
    })
    return <ProofNotReady />
  }

  // Look up the proof bound to this order. design_proofs.order_id is the link.
  const { data: proofData } = await admin
    .from('design_proofs')
    .select(
      'id, organization_id, order_id, name, status, proof_quality_status, current_version_id'
    )
    .eq('order_id', orderId)
    .eq('organization_id', context.organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const proof = proofData as ProofRow | null

  if (!proof) return <ProofNotReady />

  // Gate 3 — only order-linked proofs are visible to customers in v1.
  // (Belt-and-braces: the lookup above filters on `order_id=orderId` so a
  // null `order_id` proof can never reach here, but guard explicitly.)
  if (!proof.order_id) return <ProofNotReady />

  // Gate 4 — staff approval. Per stabilisation spec 2026-05-13 §G.5, customer
  // visibility is gated by the dedicated `order_proof_approval_gate` column
  // (written by `POST /api/proofs/[id]/approve`) AND the proof being in
  // `sent_to_customer`. Production-approval (`orders.status='approved'`) is
  // a downstream operation that no longer affects customer visibility.
  // Predicate shared with /proofs archive via lib/proofs/visibility.ts.
  if (
    !isProofVisibleToCustomer({
      approvalGate: order.order_proof_approval_gate,
      proofQualityStatus: proof.proof_quality_status,
    })
  ) {
    return <ProofNotReady />
  }

  // Happy path — load the snapshot for the current version and render.
  if (!proof.current_version_id) return <ProofNotReady />

  const { data: versionData } = await admin
    .from('design_proof_versions')
    .select('id, snapshot_data')
    .eq('id', proof.current_version_id)
    .maybeSingle()
  const version = versionData as VersionRow | null

  if (!version) return <ProofNotReady />

  const document = coerceProofDocument(version.snapshot_data)
  const canEdit = ALLOWED_EDIT_ROLES.has(context.role)

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Proof</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{proof.name || 'Proof'}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            Read-only view of the proof prepared by our team for this order.
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/orders/${orderId}/proof/edit`}
            className="inline-flex items-center rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90"
          >
            Edit proof
          </Link>
        )}
      </div>

      {amendmentSubmitted && (
        <div
          className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm leading-6 text-green-900"
          role="status"
        >
          Your edits have been submitted — we&apos;ll email you when the proof updates.
        </div>
      )}

      <ProofViewer document={document} proofName={proof.name || 'Proof'} />
    </div>
  )
}
