import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'

export interface B2BCustomerContext {
  userId: string
  email: string
  fullName: string
  organizationId: string
  organizationName: string
  customerCode: string | null
  b2bAccountId: string | null
  tierLevel: number | null
  paymentTerms: string | null
  defaultDepositPercent: number | null
  storeIds: string[]
}

export type AuthFailureKind =
  | 'unauthenticated'
  | 'no_org'
  | 'org_not_found'
  | 'missing_customer_code'

export interface AuthFailure {
  kind: AuthFailureKind
}

export type RequireB2BCustomerResult =
  | AuthFailure
  | { admin: SupabaseClient; context: B2BCustomerContext }

export async function requireB2BCustomer(
  opts: { requireCustomerCode?: boolean } = {}
): Promise<RequireB2BCustomerResult> {
  const authed = await getSupabaseServerComponent()
  const { data: { user } } = await authed.auth.getUser()
  if (!user) return { kind: 'unauthenticated' }

  const admin = getSupabaseServer()

  const { data: membership } = await admin
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { kind: 'no_org' }

  const [{ data: org }, { data: b2b }, { data: stores }, { data: profile }] = await Promise.all([
    admin.from('organizations')
      .select('id, name, customer_code')
      .eq('id', membership.organization_id).single(),
    admin.from('b2b_accounts')
      .select('id, tier_level, payment_terms, default_deposit_percent')
      .eq('organization_id', membership.organization_id).maybeSingle(),
    admin.from('stores')
      .select('id')
      .eq('organization_id', membership.organization_id),
    admin.from('profiles')
      .select('email, full_name')
      .eq('id', user.id).maybeSingle(),
  ])
  if (!org) return { kind: 'org_not_found' }

  if (opts.requireCustomerCode && !org.customer_code) {
    return { kind: 'missing_customer_code' }
  }

  return {
    admin,
    context: {
      userId: user.id,
      email: profile?.email ?? user.email ?? '',
      fullName: profile?.full_name ?? '',
      organizationId: org.id,
      organizationName: org.name,
      customerCode: org.customer_code,
      b2bAccountId: b2b?.id ?? null,
      tierLevel: b2b?.tier_level ?? null,
      paymentTerms: b2b?.payment_terms ?? null,
      defaultDepositPercent: b2b?.default_deposit_percent ?? null,
      storeIds: (stores ?? []).map((s) => s.id),
    } satisfies B2BCustomerContext,
  }
}

const AUTH_FAILURE_RESPONSE: Record<AuthFailureKind, { status: number; message: string }> = {
  unauthenticated: { status: 401, message: 'Unauthorized' },
  no_org: { status: 403, message: 'No organization on this account' },
  org_not_found: { status: 404, message: 'Organization not found' },
  missing_customer_code: {
    status: 400,
    message: 'Your account has no customer_code set. Contact staff to set up your account.',
  },
}

export type RequireB2BCustomerApiResult =
  | { error: NextResponse }
  | { admin: SupabaseClient; context: B2BCustomerContext }

export async function requireB2BCustomerApi(
  opts: { requireCustomerCode?: boolean } = {}
): Promise<RequireB2BCustomerApiResult> {
  const result = await requireB2BCustomer(opts)
  if ('kind' in result) {
    const mapped = AUTH_FAILURE_RESPONSE[result.kind]
    return { error: NextResponse.json({ error: mapped.message }, { status: mapped.status }) }
  }
  return result
}
