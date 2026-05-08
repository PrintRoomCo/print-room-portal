export const AUDIT_ACTIONS = {
  ORDER_SUBMIT: 'order.submit',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]
