import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { AuthFailure } from './server'

/**
 * Page-level handler for `requireB2BCustomer` failures. Routes by `kind`:
 * - `unauthenticated`        → /sign-in?returnTo=<originalPath>
 * - `no_org` / `org_not_found` → /account?reason=no_org
 * - `missing_customer_code`  → /checkout?reason=missing_customer_code
 *
 * Returns `never` so the call site can narrow the auth result after invocation.
 */
export async function handleAuthFailure(failure: AuthFailure): Promise<never> {
  const path = (await headers()).get('x-pathname') ?? '/'
  switch (failure.kind) {
    case 'unauthenticated':
      redirect(`/sign-in?returnTo=${encodeURIComponent(path)}`)
    case 'no_org':
    case 'org_not_found':
      redirect('/account?reason=no_org')
    case 'missing_customer_code':
      redirect('/checkout?reason=missing_customer_code')
  }
}
