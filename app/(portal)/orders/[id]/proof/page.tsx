import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { ProofNotReady } from '@/components/proofs/ProofNotReady'
import { ProofViewer } from '@/components/proofs/ProofViewer'
import { coerceProofDocument } from '@/lib/proofs/types'

export const dynamic = 'force-dynamic'

interface OrderRow {
  id: string
  status: string | null
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

/**
 * Customer "View proof" page.
 *
 * Slice F of the proof-creator product-first rollout (spec §G, plan F2).
 * Gates an authenticated buyer to a read-only render of the proof on their order.
 *
 * Gates (all enforced in this RSC; RLS on design_proofs also enforces org-scope
 * at the DB level via the `design_proofs_org_member_read` policy):
 *   1. requireB2BCustomer()             - auth gate
 *   2. order.quotes.organization_id     - org gate
 *   3. proof.order_id non-null          - order-linked gate
 *   4. order.status='approved' + proof  - staff-approval gate
 *      .proof_quality_status visible
 *
 * Slice G adds the "Edit proof" entry point. This page intentionally renders
 * read-only.
 */
export default async function OrderProofPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: orderId } = await params

  // Gate 1 — auth. Anonymous / no-org users are redirected per handleAuthFailure.
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  // Resolve the order + its org (the org gate). We do not leak that the order
  // exists if the caller's org doesn't match — the ProofNotReady panel is the
  // single 403 surface.
  const { data: orderData } = await admin
    .from('orders')
    .select('id, status, quote_id, quotes!inner(organization_id)')
    .eq('id', orderId)
    .maybeSingle()
  const order = orderData as unknown as OrderRow | null

  if (!order || !order.quotes) return <ProofNotReady />

  // Gate 2 — org membership. The caller's organizationId must match the
  // order's quote's organization_id.
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

  // Gate 4 — staff approval. Per spec §E.2 + §G, the customer only sees the
  // proof once staff has approved the order. The approve route flips
  // orders.status to 'approved' AND sets proof_quality_status to
  // 'attached_to_monday' (then 'sent_to_customer' once the proof email goes
  // out). Anything earlier is "not ready".
  const VISIBLE_QUALITY_STATES = new Set(['attached_to_monday', 'sent_to_customer'])
  const orderApproved = order.status === 'approved'
  const proofVisible = VISIBLE_QUALITY_STATES.has(proof.proof_quality_status)

  if (!orderApproved || !proofVisible) return <ProofNotReady />

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

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Proof</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{proof.name || 'Proof'}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Read-only view of the proof prepared by our team for this order.
        </p>
      </div>

      <ProofViewer document={document} proofName={proof.name || 'Proof'} />
    </div>
  )
}
