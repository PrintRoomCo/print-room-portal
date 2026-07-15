/**
 * Item 13 — recipient for the internal order-placed dispatch notification.
 * Production orders notify the dispatch desk (DISPATCH_NOTIFICATION_EMAIL,
 * default charlotte@theprint-room.co.nz). Test/demo orgs (organizations.is_test)
 * must never notify the real desk — route to the test inbox instead.
 *
 * NOTE: distinct from resolveOrderEmailRecipient (which routes prod → the
 * customer). This notification always targets a fixed staff address in prod.
 */
export function resolveDispatchNotificationRecipient(opts: {
  isTestOrg: boolean
  testEmail: string
}): string {
  if (opts.isTestOrg) return opts.testEmail
  return process.env.DISPATCH_NOTIFICATION_EMAIL || 'charlotte@theprint-room.co.nz'
}
