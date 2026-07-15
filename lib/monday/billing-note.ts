/** Conditional Monday billing note (supersedes Spec A's flat note). */
export function orderBillingNote(input: { needsInvoicing: boolean; pickFee: number }): string {
  const fee = `$${input.pickFee.toFixed(2)}`
  return input.needsInvoicing
    ? `Not paid — draft quote raised, invoice before dispatch. Pick fee ${fee}.`
    : `Prepaid — no Xero invoice required (pick fee ${fee} only).`
}
