import type { SupabaseClient } from '@supabase/supabase-js'
import { coerceProofDocument } from '@/lib/proofs/types'

export const CUSTOMER_VISIBLE_PROOF_GATE = 'approved'
export const CUSTOMER_VISIBLE_PROOF_STATUS = 'sent_to_customer'

export interface VisibleProofRow {
  id: string
  name: string
  orderId: string | null
  orderRef: string | null
  customerName: string | null
  customerEmail: string | null
  proofQualityStatus: string
  approvalGate: string
  sentAt: string | null
  mockupUrl: string | null
  designCount: number
  currentVersionId: string | null
}

interface ProofRow {
  id: string
  name: string | null
  order_id: string | null
  customer_name: string | null
  customer_email: string | null
  proof_quality_status: string | null
  current_version_id: string | null
  updated_at: string | null
  created_at: string | null
}

interface OrderRow {
  id: string
  quote_id: string | null
  order_proof_approval_gate: string | null
  order_proof_approved_at: string | null
}

interface QuoteRow {
  id: string
  organization_id: string | null
  order_ref: string | null
  customer_name: string | null
  customer_email: string | null
}

interface VersionRow {
  id: string
  snapshot_data: unknown
  created_at: string | null
}

export function isProofVisibleToCustomer({
  approvalGate,
  proofQualityStatus,
}: {
  approvalGate: string | null | undefined
  proofQualityStatus: string | null | undefined
}) {
  return (
    approvalGate === CUSTOMER_VISIBLE_PROOF_GATE &&
    proofQualityStatus === CUSTOMER_VISIBLE_PROOF_STATUS
  )
}

/**
 * Returns order-linked proofs a buyer is permitted to see for one organization.
 * This is the customer-portal visibility predicate shared by /proofs and the
 * single-order proof viewer:
 *
 *   orders.order_proof_approval_gate = 'approved'
 *   AND design_proofs.proof_quality_status = 'sent_to_customer'
 */
export async function listVisibleProofsForOrg(
  admin: SupabaseClient,
  organizationId: string,
): Promise<VisibleProofRow[]> {
  const { data: proofData, error: proofError } = await admin
    .from('design_proofs')
    .select(
      'id, name, order_id, customer_name, customer_email, proof_quality_status, current_version_id, updated_at, created_at',
    )
    .eq('organization_id', organizationId)
    .eq('proof_quality_status', CUSTOMER_VISIBLE_PROOF_STATUS)
    .not('order_id', 'is', null)
    .order('updated_at', { ascending: false })

  if (proofError) throw new Error(`Proof archive lookup failed: ${proofError.message}`)

  const proofs = (proofData ?? []) as ProofRow[]
  const orderIds = unique(proofs.map((proof) => proof.order_id).filter(Boolean))
  const versionIds = unique(proofs.map((proof) => proof.current_version_id).filter(Boolean))

  if (orderIds.length === 0) return []

  const { data: orderData, error: orderError } = await admin
    .from('orders')
    .select('id, quote_id, order_proof_approval_gate, order_proof_approved_at')
    .in('id', orderIds)

  if (orderError) throw new Error(`Proof archive order lookup failed: ${orderError.message}`)

  const orders = (orderData ?? []) as OrderRow[]
  const quoteIds = unique(orders.map((order) => order.quote_id).filter(Boolean))

  const [quoteResult, versionResult] = await Promise.all([
    quoteIds.length > 0
      ? admin
          .from('quotes')
          .select('id, organization_id, order_ref, customer_name, customer_email')
          .in('id', quoteIds)
      : Promise.resolve({ data: [], error: null }),
    versionIds.length > 0
      ? admin
          .from('design_proof_versions')
          .select('id, snapshot_data, created_at')
          .in('id', versionIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (quoteResult.error) {
    throw new Error(`Proof archive quote lookup failed: ${quoteResult.error.message}`)
  }
  if (versionResult.error) {
    throw new Error(`Proof archive version lookup failed: ${versionResult.error.message}`)
  }

  const orderById = new Map(orders.map((order) => [order.id, order]))
  const quoteById = new Map(((quoteResult.data ?? []) as QuoteRow[]).map((quote) => [quote.id, quote]))
  const versionById = new Map(
    ((versionResult.data ?? []) as VersionRow[]).map((version) => [version.id, version]),
  )

  return proofs
    .map((proof) => {
      const order = proof.order_id ? orderById.get(proof.order_id) : null
      const quote = order?.quote_id ? quoteById.get(order.quote_id) : null
      const version = proof.current_version_id ? versionById.get(proof.current_version_id) : null

      if (!order || !quote || quote.organization_id !== organizationId) return null
      if (
        !isProofVisibleToCustomer({
          approvalGate: order.order_proof_approval_gate,
          proofQualityStatus: proof.proof_quality_status,
        })
      ) {
        return null
      }

      const document = coerceProofDocument(version?.snapshot_data)
      const firstDesign = document.designs[0]

      return {
        id: proof.id,
        name: proof.name || quote.order_ref || 'Proof',
        orderId: proof.order_id,
        orderRef: quote.order_ref,
        customerName: proof.customer_name ?? quote.customer_name,
        customerEmail: proof.customer_email ?? quote.customer_email,
        proofQualityStatus: proof.proof_quality_status ?? '',
        approvalGate: order.order_proof_approval_gate ?? '',
        sentAt: order.order_proof_approved_at ?? version?.created_at ?? proof.updated_at ?? proof.created_at,
        mockupUrl:
          firstDesign?.frontMockupUrl ||
          firstDesign?.backMockupUrl ||
          firstDesign?.artworkUrl ||
          null,
        designCount: document.designs.length,
        currentVersionId: proof.current_version_id,
      } satisfies VisibleProofRow
    })
    .filter((proof): proof is VisibleProofRow => Boolean(proof))
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
