// MIRROR: keep proof-related actions in sync with
// `print-room-staff-portal/src/lib/audit/actions.ts`. Same string values so
// cross-repo audit queries can group by `action`. Spec 2026-05-13 §G.4 + §M.R7.
export const AUDIT_ACTIONS = {
  ORDER_SUBMIT: 'order.submit',
  ORDER_MONDAY_PUSH_FAILED: 'order.monday_push_failed',
  ORDER_PRE_APPROVED_INVENTORY: 'order.pre_approved_inventory',
  ORDER_PRE_APPROVED_INVENTORY_FAILED: 'order.pre_approved_inventory_failed',
  ORDER_JOB_TRACKER_CREATED: 'order.job_tracker_created',
  ORDER_JOB_TRACKER_CREATE_FAILED: 'order.job_tracker_create_failed',
  ORDER_JOB_TRACKER_MONDAY_LINK_FAILED: 'order.job_tracker_monday_link_failed',
  ORDER_XERO_DRAFTED: 'order.xero_drafted',
  ORDER_XERO_MANUAL_REVIEW: 'order.xero_manual_review',
  ORDER_XERO_DRAFT_FAILED: 'order.xero_draft_failed',

  PROOF_AUTOFILL_SUCCEEDED: 'proof.autofill_succeeded',
  PROOF_AUTOFILL_SKIPPED: 'proof.autofill_skipped',
  PROOF_AUTOFILL_FAILED: 'proof.autofill_failed',
  PROOF_AUTOFILL_PARTIAL: 'proof.autofill_partial',
  PROOF_AUTOFILL_AM_NOTIFIED: 'proof.autofill_am_notified',
  PROOF_AUTOFILL_AM_NOTIFICATION_FAILED: 'proof.autofill_am_notification_failed',
  PROOF_AUTOFILL_AM_NO_RECIPIENT: 'proof.autofill_am_no_recipient',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]
