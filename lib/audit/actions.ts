// MIRROR: keep proof-related actions in sync with
// `print-room-staff-portal/src/lib/audit/actions.ts`. Same string values so
// cross-repo audit queries can group by `action`. Spec 2026-05-13 §G.4 + §M.R7.
export const AUDIT_ACTIONS = {
  // MIRROR staff src/lib/audit/actions.ts so member.* events group cross-repo.
  MEMBER_INVITE: 'member.invite',
  // MIRROR staff B2B_MEMBER_STORE_GRANTS_CHANGE — same string so the grant-change
  // audit groups cross-repo whether written by staff or the customer team screen.
  B2B_MEMBER_STORE_GRANTS_CHANGE: 'b2b_member_store_grants.change',

  ORDER_SUBMIT: 'order.submit',
  // Customer-only (design 2026-08-11). NOT mirrored to staff — order.* actions
  // are not part of the cross-repo MIRROR contract.
  TERMS_ACCEPTED: 'order.terms_accepted',
  ORDER_TYPE_STAMP_FAILED: 'order.order_type_stamp_failed',
  ORDER_MONDAY_PUSH_FAILED: 'order.monday_push_failed',
  ORDER_PRE_APPROVED_INVENTORY: 'order.pre_approved_inventory',
  ORDER_PRE_APPROVED_INVENTORY_FAILED: 'order.pre_approved_inventory_failed',
  ORDER_JOB_TRACKER_CREATED: 'order.job_tracker_created',
  ORDER_JOB_TRACKER_CREATE_FAILED: 'order.job_tracker_create_failed',
  ORDER_JOB_TRACKER_MONDAY_LINK_FAILED: 'order.job_tracker_monday_link_failed',
  ORDER_XERO_DRAFTED: 'order.xero_drafted',
  ORDER_XERO_MANUAL_REVIEW: 'order.xero_manual_review',
  ORDER_XERO_DRAFT_FAILED: 'order.xero_draft_failed',
  /** AU Stage 1 — AU order with no XERO_AU_* credentials yet (dark path). */
  ORDER_XERO_DRAFT_SKIPPED: 'order.xero_draft_skipped',
  ORDER_STARSHIPIT_PUSHED: 'order.starshipit_pushed',
  ORDER_STARSHIPIT_SKIPPED: 'order.starshipit_skipped',
  ORDER_STARSHIPIT_PUSH_FAILED: 'order.starshipit_push_failed',
  ORDER_STARSHIPIT_DELETED: 'order.starshipit_deleted',
  ORDER_STARSHIPIT_DELETE_FAILED: 'order.starshipit_delete_failed',

  PROOF_AUTOFILL_SUCCEEDED: 'proof.autofill_succeeded',
  PROOF_AUTOFILL_SKIPPED: 'proof.autofill_skipped',
  PROOF_AUTOFILL_FAILED: 'proof.autofill_failed',
  PROOF_AUTOFILL_PARTIAL: 'proof.autofill_partial',
  PROOF_AUTOFILL_AM_NOTIFIED: 'proof.autofill_am_notified',
  PROOF_AUTOFILL_AM_NOTIFICATION_FAILED: 'proof.autofill_am_notification_failed',
  PROOF_AUTOFILL_AM_NO_RECIPIENT: 'proof.autofill_am_no_recipient',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]
