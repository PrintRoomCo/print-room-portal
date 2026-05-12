import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { coerceProofDocument, type ProofDocument } from '@/lib/proofs/types'
import { buildDiffSummary, computeAmendmentDiff } from '@/lib/proofs/compute-amendment-diff'

/**
 * POST /api/proofs/[id]/amendment-requests
 *
 * Customer submits a staged proof edit. Server re-fetches the authoritative
 * current snapshot, computes the diff against it, validates every changed
 * path is on the customer-editable allow-list, and writes a
 * `proof_amendment_requests` row.
 *
 * Security boundary contract (do NOT relax without spec sign-off):
 *
 *   1. The client supplies `stagedSnapshot` (post-edit doc) and the
 *      `versionId` it was editing against. We NEVER trust a client-supplied
 *      `originalSnapshot` — we re-fetch from
 *      `design_proof_versions.snapshot_data`.
 *
 *   2. Buyer-role gate: caller must have `user_organizations.role IN
 *      ('org_admin','buyer')` for the proof's org. RLS on the table is the
 *      second line of defence; this route is the first.
 *
 *   3. Allow-list gate: every diff path must be in CUSTOMER_EDITABLE_FIELDS.
 *      Any violation -> reject the whole request 400. We do not silently
 *      filter.
 *
 *   4. Stale-version gate: if `proof.current_version_id` has moved on since
 *      the client started editing -> 409 so the customer can re-apply
 *      against the new base. We surface their staged snapshot back so they
 *      don't lose work.
 */

interface ProofRow {
  id: string
  organization_id: string
  order_id: string | null
  status: string
  proof_quality_status: string
  current_version_id: string | null
  created_by_user_id: string | null
}

interface OrderRow {
  id: string
  status: string | null
}

interface VersionRow {
  id: string
  snapshot_data: unknown
}

interface RequestBody {
  versionId?: unknown
  stagedSnapshot?: unknown
  body?: unknown
}

const VISIBLE_QUALITY_STATES = new Set(['attached_to_monday', 'sent_to_customer'])
const ALLOWED_ROLES = new Set(['org_admin', 'buyer'])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  // Buyer-role gate. Today the schema only has 'org_admin' | 'buyer', but
  // we check explicitly so adding a 'viewer' role later is a no-op here.
  if (!ALLOWED_ROLES.has(context.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id: proofId } = await params
  if (!isUuid(proofId)) {
    return NextResponse.json({ error: 'invalid_proof_id' }, { status: 400 })
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const clientVersionId = typeof body.versionId === 'string' ? body.versionId : null
  if (!clientVersionId || !isUuid(clientVersionId)) {
    return NextResponse.json({ error: 'missing_version_id' }, { status: 400 })
  }
  if (!body.stagedSnapshot || typeof body.stagedSnapshot !== 'object') {
    return NextResponse.json({ error: 'missing_staged_snapshot' }, { status: 400 })
  }
  const noteBody =
    typeof body.body === 'string' && body.body.trim().length > 0 ? body.body.trim() : null

  // Resolve the proof + org-membership gate. Mirrors the read in the page.
  const { data: proofData } = await admin
    .from('design_proofs')
    .select(
      'id, organization_id, order_id, status, proof_quality_status, current_version_id, created_by_user_id'
    )
    .eq('id', proofId)
    .maybeSingle()
  const proof = proofData as ProofRow | null

  if (!proof) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (proof.organization_id !== context.organizationId) {
    // Do not leak whether the proof exists for a different org.
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!proof.order_id) {
    return NextResponse.json({ error: 'not_editable' }, { status: 403 })
  }
  if (!VISIBLE_QUALITY_STATES.has(proof.proof_quality_status)) {
    return NextResponse.json({ error: 'not_editable' }, { status: 403 })
  }

  // Re-check the order approval gate — customers can only request edits on
  // an approved proof (the same gate the read page enforces).
  const { data: orderData } = await admin
    .from('orders')
    .select('id, status')
    .eq('id', proof.order_id)
    .maybeSingle()
  const order = orderData as OrderRow | null
  if (!order || order.status !== 'approved') {
    return NextResponse.json({ error: 'not_editable' }, { status: 403 })
  }

  // Stale-version guard. If the proof has been re-versioned since the
  // client opened the editor, reject with the staged snapshot echoed back
  // so the customer can re-apply.
  if (!proof.current_version_id) {
    return NextResponse.json({ error: 'not_editable' }, { status: 403 })
  }
  if (proof.current_version_id !== clientVersionId) {
    return NextResponse.json(
      {
        error: 'proof_updated',
        message:
          'The proof was updated while you were editing. Refresh and try again.',
        currentVersionId: proof.current_version_id,
        stagedSnapshot: body.stagedSnapshot,
      },
      { status: 409 }
    )
  }

  // Authoritative re-fetch of the snapshot the diff is computed against.
  // NEVER trust a client-supplied originalSnapshot.
  const { data: versionData } = await admin
    .from('design_proof_versions')
    .select('id, snapshot_data')
    .eq('id', proof.current_version_id)
    .maybeSingle()
  const version = versionData as VersionRow | null
  if (!version) {
    return NextResponse.json({ error: 'version_missing' }, { status: 500 })
  }

  const originalDoc = coerceProofDocument(version.snapshot_data)
  const stagedDoc: ProofDocument = coerceProofDocument(body.stagedSnapshot)

  const result = computeAmendmentDiff(originalDoc, stagedDoc)
  if (!result.ok) {
    return NextResponse.json(
      {
        error: 'field_not_editable',
        field: result.field,
        instancePath: result.instancePath,
      },
      { status: 400 }
    )
  }
  if (result.diff.length === 0) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  }

  const diffSummary = buildDiffSummary(result.diff)

  const { data: insertData, error: insertError } = await admin
    .from('proof_amendment_requests')
    .insert({
      proof_id: proof.id,
      proof_version_id: version.id,
      requested_by_user_id: context.userId,
      body: noteBody,
      original_snapshot: version.snapshot_data,
      staged_snapshot: stagedDoc,
      diff_summary: diffSummary,
      status: 'open',
    })
    .select('id')
    .single()

  if (insertError || !insertData) {
    console.error('[amendment-request] insert failed', insertError)
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  // Best-effort AM notification — audit_events row for the staff portal's
  // notifications surface. Resend wrapper not wired in this repo; the
  // staff portal Slice H/I will pick this up. Failure here must not bubble.
  try {
    await admin.from('audit_events').insert({
      org_id: proof.organization_id,
      actor_user_id: context.userId,
      action: 'proof.amendment_requested',
      target_type: 'proof_amendment_request',
      target_id: insertData.id,
      metadata: {
        proofId: proof.id,
        proofVersionId: version.id,
        orderId: proof.order_id,
        diffSummary,
        deferred: 'no_resend_wrapper_in_customer_portal',
      },
    })
  } catch (err) {
    console.warn('[amendment-request] audit_events deferred log failed', err)
  }
  try {
    await admin.from('audit_events').insert({
      org_id: proof.organization_id,
      actor_user_id: context.userId,
      action: 'proof.amendment_request_am_deferred',
      target_type: 'proof_amendment_request',
      target_id: insertData.id,
      metadata: { reason: 'customer_portal_has_no_resend_wrapper' },
    })
  } catch {
    // swallow — defer logging is itself best-effort.
  }

  return NextResponse.json({ id: insertData.id }, { status: 201 })
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}
