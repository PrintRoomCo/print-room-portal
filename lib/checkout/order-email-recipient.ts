/**
 * Recipient for order-confirmation email. Test/demo orgs (organizations.is_test)
 * must never email a real customer — route to the test inbox instead.
 */
export function resolveOrderEmailRecipient(opts: {
  isTestOrg: boolean
  customerEmail: string
  testEmail: string
}): string {
  return opts.isTestOrg ? opts.testEmail : opts.customerEmail
}
