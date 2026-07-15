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

/**
 * Fail-closed is_test classification for the post-commit side-effects that key
 * off it (order-confirmation email, dispatch notification, Xero draft). The
 * order is already committed by the time we re-read the org, so if that lookup
 * ERRORS or returns NO ROW we cannot confirm the org is a real customer — treat
 * it as a test org (route to the test inbox / skip the live Xero push) rather
 * than risk emailing a real customer or drafting for an unclassifiable org.
 */
export function isTestOrgFailClosed(result: {
  data: { is_test?: boolean | null } | null
  error: unknown
}): boolean {
  if (result.error || !result.data) return true
  return Boolean(result.data.is_test)
}
