// MIRROR: keep in sync with
// `print-room-staff-portal/src/lib/proofs/autofill-for-order.ts`.
// F1 (spec 2026-05-13 §G.4) — customer-portal twin of the staff helper.
// Never throws; every failure path collapses to an audit_events row.
//
// Current contract:
// - Expects the submitted order to have a linked quote with quote_items rows.
// - Uses quote_items.decorations snapshots to carry decoration link ids,
//   artwork URLs, and decoration snapshot URLs into the v1 proof document.
// - Maps each decorated order line into proof order rows with catalogue-source
//   metadata when the decoration link still resolves to a catalogue item.
// - Creates or reuses one draft design_proof per order in an AM-amendable state:
//   design_proofs.status='draft' and proof_quality_status='draft_generated'.
// Known gap: undecorated quote_items are checklist entries rather than proof
// order rows, because there is no decoration link or artwork to assemble.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadReadyProductsForOrganization } from '@/lib/proofs/load-ready-products'
import { loadOrderProofAssembly } from '@/lib/proofs/order-assembly'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { sendProofEmail } from '@/lib/email/send-proof-email'

export interface AutofillOrderRow {
  orderId: string
  quoteId: string
  organizationId: string
  customerName: string
  customerEmail: string
  orderRef: string
  /**
   * Product UUIDs from the submitted order lines. We resolve catalogue items
   * by intersecting these with the org's ready-products' `sourceProductId`.
   */
  productIds: string[]
}

export type AutofillSkipReason = 'no_items' | 'creation_failed' | null

export interface AutofillProofResult {
  proofId: string | null
  skipped: AutofillSkipReason
}

interface ExistingProofRow {
  id: string
  current_version_id: string | null
}

export async function autofillProofForOrder(
  orderRow: AutofillOrderRow,
  admin: SupabaseClient,
): Promise<AutofillProofResult> {
  try {
    const existingProof = await findExistingOrderProof(admin, orderRow.orderId)
    if (existingProof?.current_version_id) {
      await safeAuditLog({
        orgId: orderRow.organizationId,
        action: AUDIT_ACTIONS.PROOF_AUTOFILL_SKIPPED,
        targetId: existingProof.id,
        metadata: {
          orderId: orderRow.orderId,
          proofId: existingProof.id,
          orderRef: orderRow.orderRef,
          reason: 'already_exists',
          source: 'customer_portal',
        },
      })
      return { proofId: existingProof.id, skipped: null }
    }

    const ready = await loadReadyProductsForOrganization(admin, orderRow.organizationId)
    const productIdSet = new Set(orderRow.productIds.filter(Boolean))
    const matching = ready.products.filter((p) => productIdSet.has(p.sourceProductId))

    if (matching.length === 0) {
      await safeAuditLog({
        orgId: orderRow.organizationId,
        action: AUDIT_ACTIONS.PROOF_AUTOFILL_SKIPPED,
        targetId: orderRow.orderId,
        metadata: {
          orderId: orderRow.orderId,
          orderRef: orderRow.orderRef,
          reason: 'no_items',
          productIds: orderRow.productIds,
        },
      })
      return { proofId: null, skipped: 'no_items' }
    }

    const assembly = await loadOrderProofAssembly(admin, orderRow.orderId, {
      name: undefined,
      email: undefined,
    })
    if (assembly.checklist.length > 0) {
      await safeAuditLog({
        orgId: orderRow.organizationId,
        action: AUDIT_ACTIONS.PROOF_AUTOFILL_PARTIAL,
        targetId: orderRow.orderId,
        metadata: {
          orderId: orderRow.orderId,
          orderRef: orderRow.orderRef,
          checklist: assembly.checklist,
          source: 'customer_portal',
        },
      })
    }

    const { data: organization, error: orgError } = await admin
      .from('organizations')
      .select('id, name')
      .eq('id', orderRow.organizationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (orgError) throw new Error(`Organization lookup failed: ${orgError.message}`)

    const orgName = organization?.name ?? orderRow.customerName ?? 'Client'
    const document = assembly.document
    const sourceCatalogueItemIds = matching.map((p) => p.catalogueItemId)

    let proof = existingProof
    let createdProof = false
    if (!proof) {
      const { data: inserted, error: proofError } = await admin
        .from('design_proofs')
        .insert({
          organization_id: orderRow.organizationId,
          order_id: orderRow.orderId,
          quote_id: orderRow.quoteId,
          name: orderRow.orderRef,
          customer_email: orderRow.customerEmail,
          customer_name: orderRow.customerName,
          status: 'draft',
          proof_quality_status: 'draft_generated',
          // No staff actor on customer-originated submits. Staff dashboards
          // surface these shells regardless via the design_proofs RLS policy.
          created_by_user_id: null,
          source_catalogue_item_ids: sourceCatalogueItemIds,
        })
        .select('id, current_version_id')
        .single()

      if (proofError || !inserted) {
        const racedExisting = await findExistingOrderProof(admin, orderRow.orderId)
        if (!racedExisting) {
          throw new Error(`Proof insert failed: ${proofError?.message ?? 'no row returned'}`)
        }
        proof = racedExisting
      } else {
        proof = inserted as ExistingProofRow
        createdProof = true
      }
    } else {
      await admin
        .from('design_proofs')
        .update({ source_catalogue_item_ids: sourceCatalogueItemIds })
        .eq('id', proof.id)
    }

    if (proof.current_version_id) {
      return { proofId: proof.id, skipped: null }
    }

    const { data: latest, error: latestError } = await admin
      .from('design_proof_versions')
      .select('version_number')
      .eq('proof_id', proof.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestError) {
      throw new Error(`Proof version lookup failed: ${latestError.message}`)
    }

    const { data: version, error: versionError } = await admin
      .from('design_proof_versions')
      .insert({
        proof_id: proof.id,
        version_number: (latest?.version_number ?? 0) + 1,
        status: 'draft',
        snapshot_data: document,
        change_order_fee_amount: 0,
        created_by_user_id: null,
      })
      .select('id')
      .single()

    if (versionError || !version) {
      if (createdProof) await admin.from('design_proofs').delete().eq('id', proof.id)
      throw new Error(`Proof version insert failed: ${versionError?.message ?? 'no row returned'}`)
    }

    const { error: updateError } = await admin
      .from('design_proofs')
      .update({ current_version_id: version.id })
      .eq('id', proof.id)
    if (updateError) {
      await admin.from('design_proof_versions').delete().eq('id', version.id)
      if (createdProof) await admin.from('design_proofs').delete().eq('id', proof.id)
      throw new Error(`Proof current_version_id update failed: ${updateError.message}`)
    }

    await safeAuditLog({
      orgId: orderRow.organizationId,
      action: AUDIT_ACTIONS.PROOF_AUTOFILL_SUCCEEDED,
      targetId: proof.id,
      metadata: {
        orderId: orderRow.orderId,
        proofId: proof.id,
        versionId: version.id,
        sourceCatalogueItemIds,
        assemblyChecklist: assembly.checklist,
        reusedExistingProof: !createdProof,
        source: 'customer_portal',
      },
    })

    await notifyAmBestEffort({
      admin,
      orderRow,
      proofId: proof.id,
      orgName,
      lineCount: matching.length,
    })

    return { proofId: proof.id, skipped: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await safeAuditLog({
      orgId: orderRow.organizationId,
      action: AUDIT_ACTIONS.PROOF_AUTOFILL_FAILED,
      targetId: orderRow.orderId,
      metadata: {
        orderId: orderRow.orderId,
        orderRef: orderRow.orderRef,
        error: message,
        source: 'customer_portal',
      },
    })
    return { proofId: null, skipped: 'creation_failed' }
  }
}

async function findExistingOrderProof(
  admin: SupabaseClient,
  orderId: string,
): Promise<ExistingProofRow | null> {
  const { data, error } = await admin
    .from('design_proofs')
    .select('id, current_version_id')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Existing proof lookup failed: ${error.message}`)
  }

  return (data as ExistingProofRow | null) ?? null
}

async function safeAuditLog(args: {
  orgId: string | null
  action: string
  targetId: string | null
  metadata: Record<string, unknown>
}): Promise<void> {
  try {
    await recordAuditEvent({
      orgId: args.orgId,
      actorUserId: null,
      action: args.action,
      targetType: 'order_proof_autofill',
      targetId: args.targetId,
      metadata: args.metadata,
    })
  } catch (err) {
    console.error('autofillProofForOrder: audit_event write threw', {
      action: args.action,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// AM notification: customer-originated submits have no `created_by_user_id`
// so resolution falls to `orders.assigned_to`. If neither resolves, audit
// `proof.autofill_am_no_recipient` and bail.
type ResolvedAm = { userId: string; email: string; firstName: string | null }

function resolveStaffPortalUrl(): string | null {
  const raw =
    process.env.STAFF_PORTAL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    ''
  return raw ? raw.replace(/\/+$/, '') : null
}

function extractFirstName(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  if (typeof m.first_name === 'string' && m.first_name.trim()) return m.first_name.trim()
  if (typeof m.given_name === 'string' && m.given_name.trim()) return m.given_name.trim()
  return null
}

async function lookupAuthUser(
  admin: SupabaseClient,
  userId: string,
): Promise<{ email: string; firstName: string | null } | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error) return null
    const user = data?.user
    const email = user?.email
    if (!email) return null
    return { email, firstName: extractFirstName(user?.user_metadata) }
  } catch {
    return null
  }
}

async function resolveAmRecipient(
  admin: SupabaseClient,
  proofId: string,
  orderId: string,
): Promise<ResolvedAm | null> {
  const [proofRes, orderRes] = await Promise.all([
    admin.from('design_proofs').select('created_by_user_id').eq('id', proofId).maybeSingle(),
    admin.from('orders').select('assigned_to').eq('id', orderId).maybeSingle(),
  ])

  const createdById =
    (proofRes.data as { created_by_user_id: string | null } | null)?.created_by_user_id ?? null
  const assignedToId =
    (orderRes.data as { assigned_to: string | null } | null)?.assigned_to ?? null

  if (createdById) {
    const u = await lookupAuthUser(admin, createdById)
    if (u) return { userId: createdById, email: u.email, firstName: u.firstName }
  }
  if (assignedToId && assignedToId !== createdById) {
    const u = await lookupAuthUser(admin, assignedToId)
    if (u) return { userId: assignedToId, email: u.email, firstName: u.firstName }
  }
  return null
}

function buildAmEmailHtml(args: {
  firstName: string | null
  orderRef: string
  orgName: string | null
  lineCount: number | null
  proofLink: string | null
}): string {
  const greeting = args.firstName?.trim() || 'there'
  const customer = args.orgName?.trim() || 'a B2B customer'
  const linesLi =
    args.lineCount != null ? `  <li><strong>Lines:</strong> ${args.lineCount} item(s)</li>\n` : ''
  if (args.proofLink) {
    return (
      `<p>Hi ${greeting},</p>\n` +
      `<p>A new B2B order has been submitted and needs a proof:</p>\n` +
      `<ul>\n` +
      `  <li><strong>Order:</strong> #${args.orderRef}</li>\n` +
      `  <li><strong>Customer:</strong> ${customer}</li>\n` +
      linesLi +
      `</ul>\n` +
      `<p><a href="${args.proofLink}" style="display:inline-block;padding:10px 16px;background:#000;color:#fff;text-decoration:none;border-radius:4px">Open proof in staff portal</a></p>\n` +
      `<p>— Auto-fill via the Print Room customer portal</p>`
    )
  }
  return (
    `<p>Hi ${greeting},</p>\n` +
    `<p>A new B2B order has been submitted and needs a proof:</p>\n` +
    `<ul>\n` +
    `  <li><strong>Order:</strong> #${args.orderRef}</li>\n` +
    `  <li><strong>Customer:</strong> ${customer}</li>\n` +
    linesLi +
    `</ul>\n` +
    `<p>Open the staff portal to review.</p>`
  )
}

function buildAmEmailText(args: {
  firstName: string | null
  orderRef: string
  orgName: string | null
  lineCount: number | null
  proofLink: string | null
}): string {
  const greeting = args.firstName?.trim() || 'there'
  const customer = args.orgName?.trim() || 'a B2B customer'
  const lines: string[] = [
    `Hi ${greeting},`,
    '',
    'A new B2B order has been submitted and needs a proof:',
    '',
    `Order: #${args.orderRef}`,
    `Customer: ${customer}`,
  ]
  if (args.lineCount != null) lines.push(`Lines: ${args.lineCount} item(s)`)
  lines.push('')
  if (args.proofLink) {
    lines.push(`Open proof in staff portal: ${args.proofLink}`)
    lines.push('')
    lines.push('— Auto-fill via the Print Room customer portal')
  } else {
    lines.push('Open the staff portal to review.')
  }
  return lines.join('\n')
}

async function notifyAmBestEffort(args: {
  admin: SupabaseClient
  orderRow: AutofillOrderRow
  proofId: string
  orgName: string | null
  lineCount: number | null
}): Promise<void> {
  const { admin, orderRow, proofId, orgName, lineCount } = args
  try {
    const recipient = await resolveAmRecipient(admin, proofId, orderRow.orderId)

    if (!recipient) {
      await safeAuditLog({
        orgId: orderRow.organizationId,
        action: AUDIT_ACTIONS.PROOF_AUTOFILL_AM_NO_RECIPIENT,
        targetId: proofId,
        metadata: {
          orderId: orderRow.orderId,
          proofId,
          orderRef: orderRow.orderRef,
          reason:
            'no_am_resolved: design_proofs.created_by_user_id and orders.assigned_to both unresolved (null or email lookup failed)',
          source: 'customer_portal',
        },
      })
      return
    }

    const staffPortalUrl = resolveStaffPortalUrl()
    const proofLink = staffPortalUrl ? `${staffPortalUrl}/proofs/${proofId}` : null

    const subject = `New B2B order needs a proof — Order #${orderRow.orderRef}`
    const html = buildAmEmailHtml({
      firstName: recipient.firstName,
      orderRef: orderRow.orderRef,
      orgName,
      lineCount,
      proofLink,
    })
    const text = buildAmEmailText({
      firstName: recipient.firstName,
      orderRef: orderRow.orderRef,
      orgName,
      lineCount,
      proofLink,
    })

    let result
    try {
      result = await sendProofEmail({
        to: recipient.email,
        subject,
        html,
        text,
        kind: 'proof.am_autofill',
        correlation: { proof_id: proofId, order_id: orderRow.orderId },
      })
    } catch (sendErr) {
      await safeAuditLog({
        orgId: orderRow.organizationId,
        action: AUDIT_ACTIONS.PROOF_AUTOFILL_AM_NOTIFICATION_FAILED,
        targetId: proofId,
        metadata: {
          orderId: orderRow.orderId,
          proofId,
          am_user_id: recipient.userId,
          recipient: recipient.email,
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
          source: 'customer_portal',
        },
      })
      return
    }

    if (result.ok) {
      await safeAuditLog({
        orgId: orderRow.organizationId,
        action: AUDIT_ACTIONS.PROOF_AUTOFILL_AM_NOTIFIED,
        targetId: proofId,
        metadata: {
          orderId: orderRow.orderId,
          proofId,
          am_user_id: recipient.userId,
          recipient: recipient.email,
          resend_message_id: result.messageId,
          subject,
          source: 'customer_portal',
        },
      })
      return
    }

    await safeAuditLog({
      orgId: orderRow.organizationId,
      action: AUDIT_ACTIONS.PROOF_AUTOFILL_AM_NOTIFICATION_FAILED,
      targetId: proofId,
      metadata: {
        orderId: orderRow.orderId,
        proofId,
        am_user_id: recipient.userId,
        recipient: recipient.email,
        error: result.error,
        subject,
        source: 'customer_portal',
      },
    })
  } catch (err) {
    console.error('autofillProofForOrder: AM notification step threw (swallowed)', {
      err: err instanceof Error ? err.message : String(err),
    })
    try {
      await safeAuditLog({
        orgId: orderRow.organizationId,
        action: AUDIT_ACTIONS.PROOF_AUTOFILL_AM_NOTIFICATION_FAILED,
        targetId: proofId,
        metadata: {
          orderId: orderRow.orderId,
          proofId,
          error: err instanceof Error ? err.message : String(err),
          source: 'customer_portal_outer_catch',
        },
      })
    } catch {
      // Truly best-effort.
    }
  }
}
