/**
 * The "account is pending setup" notice, shared by /checkout and /checkout/review.
 *
 * Both pages gate on the same missing customer code, and both used to inline
 * their own copy of this paragraph. They drifted: different punctuation, one
 * said "submitting an order" and the other "placing an order", and only the
 * review page marked it as a live region. One component, one wording.
 */
export function CustomerCodeNotice() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      Your account is pending setup. Contact staff to assign your customer code before placing an
      order.
    </div>
  )
}
