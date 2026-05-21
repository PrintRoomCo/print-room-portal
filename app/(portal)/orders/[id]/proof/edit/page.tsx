import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { ProofNotReady } from '@/components/proofs/ProofNotReady'
import { ProofStagingForm } from '@/components/proofs/ProofStagingForm'
import { coerceProofDocument } from '@/lib/proofs/types'
import { getCustomerEditableFields } from '@/lib/proofs/customer-editable-fields'

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
  created_by_user_id: string | null
}

interface VersionRow {
  id: string
  snapshot_data: unknown
}

interface CreatorProfile {
  full_name: string | null
}

/**
 * Customer "Edit proof" page (Slice G).
 *
 * Renders an allow-list-scoped staging form. Same gates as Slice F's
 * read-only page plus the buyer-role gate: viewers (if a viewer role is
 * ever introduced) cannot reach this page. The form is defence in depth;
 * the API at /api/proofs/[id]/amendment-requests is the security boundary.
 */
export default async function OrderProofEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: orderId } = await params

  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  // Buyer-role gate — only org_admin or buyer roles may edit. The schema
  // today only has these two values, but the check is explicit so a future
  // viewer role can never accidentally land here.
  const ALLOWED_ROLES = new Set(['org_admin', 'buyer'])
  if (!ALLOWED_ROLES.has(context.role)) {
    return <ProofNotReady />
  }

  const { data: orderData } = await admin
    .from('orders')
    .select('id, status, quote_id, quotes!inner(organization_id)')
    .eq('id', orderId)
    .maybeSingle()
  const order = orderData as unknown as OrderRow | null

  if (!order || !order.quotes) return <ProofNotReady />
  if (order.quotes.organization_id !== context.organizationId) return <ProofNotReady />

  const { data: proofData } = await admin
    .from('design_proofs')
    .select(
      'id, organization_id, order_id, name, status, proof_quality_status, current_version_id, created_by_user_id'
    )
    .eq('order_id', orderId)
    .eq('organization_id', context.organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const proof = proofData as ProofRow | null

  if (!proof) return <ProofNotReady />
  if (!proof.order_id) return <ProofNotReady />

  const VISIBLE_QUALITY_STATES = new Set(['attached_to_monday', 'sent_to_customer'])
  if (order.status !== 'approved') return <ProofNotReady />
  if (!VISIBLE_QUALITY_STATES.has(proof.proof_quality_status)) return <ProofNotReady />
  if (!proof.current_version_id) return <ProofNotReady />

  const { data: versionData } = await admin
    .from('design_proof_versions')
    .select('id, snapshot_data')
    .eq('id', proof.current_version_id)
    .maybeSingle()
  const version = versionData as VersionRow | null
  if (!version) return <ProofNotReady />

  // Best-effort lookup of the proof creator's display name for the banner
  // copy. We don't fail the page if it's missing.
  let amName = 'our team'
  if (proof.created_by_user_id) {
    const { data: creator } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', proof.created_by_user_id)
      .maybeSingle()
    const profile = creator as CreatorProfile | null
    if (profile?.full_name) amName = profile.full_name
  }

  const document = coerceProofDocument(version.snapshot_data)
  const allowedPaths = await getCustomerEditableFields()

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Edit proof — request changes
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{proof.name || 'Proof'}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Edit the fields you&apos;d like changed and submit. Our team will review your request
          and email you when the proof updates.
        </p>
      </div>

      <ProofStagingForm
        proofId={proof.id}
        orderId={orderId}
        versionId={version.id}
        initialDocument={document}
        amName={amName}
        allowedPaths={allowedPaths}
      />
    </div>
  )
}
