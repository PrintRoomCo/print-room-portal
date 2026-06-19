import { NextResponse } from 'next/server'
import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { readPreviewSession } from '@/lib/preview/cookie'
import { buildPreviewContext } from '@/lib/preview/context'

export interface B2BCustomerContext {
  userId: string
  /** user_organizations.id — the (user, org) membership row id. Used for per-member access grants. */
  membershipId: string
  /** Buyer Roles step 6 — discriminator for ship-to lock + order list scope. */
  role: 'org_admin' | 'staff'
  email: string
  fullName: string
  organizationId: string
  organizationName: string
  customerCode: string | null
  b2bAccountId: string | null
  tierLevel: number | null
  paymentTerms: string | null
  /** Free-text contract terms; surfaced in checkout + email when pricingMode='contract'. */
  contractNotes: string | null
  pricingMode: string | null
  defaultDepositPercent: number | null
  storeIds: string[]
  /** Per-buyer default ship-to store, set by staff in the b2b-accounts members panel. Null = no default. */
  defaultStoreId: string | null
  /**
   * Customer-shape discriminator from b2b_accounts.tenant_type.
   * Null when no b2b_account row. See lib/company.ts for the full Access shape.
   */
  tenantType: 'franchise' | 'studio_plus_inventory' | 'studio' | null
  /**
   * Derived from tenantType. True only for studio_plus_inventory. Mirrors
   * B2BCustomerAccess so checkout code branches without re-deriving.
   */
  allowsMultiStoreOrdering: boolean
  /**
   * organizations.moq_exempt. When true, every product short-circuits to MOQ=1
   * — set by staff on the b2b-accounts org page for trusted multi-store
   * customers. Mirrors submit_b2b_order's top-level branch.
   */
  moqExempt: boolean
  /** Layer-2 ordering permission (user_organizations.ordering_permission). org_admin ignores it. */
  orderingPermission: import('@/lib/shop/fulfilment-mode').MemberPermission
  /** True when this context was built for a staff preview (read-only). */
  isPreview?: boolean
  /** Editor-launched preview: the in-edit catalogue item id to force-show on its PDP. */
  previewItemId?: string | null
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
  // Preview: a valid staff preview cookie renders the store as the target
  // member via service-role, with no member auth session. Reads only.
  const nowSec = Math.floor(Date.now() / 1000)
  const previewPayload = await readPreviewSession(nowSec)
  if (previewPayload) {
    const previewAdmin = getSupabaseServer()
    const preview = await buildPreviewContext(previewAdmin, previewPayload)
    if (preview) return preview
    // Stale/invalid target — fall through to normal auth.
  }

  const authed = await getSupabaseServerComponent()
  const { data: { user } } = await authed.auth.getUser()
  if (!user) return { kind: 'unauthenticated' }

  const admin = getSupabaseServer()

  const { data: membership } = await admin
    .from('user_organizations')
    .select('id, organization_id, default_store_id, role, ordering_permission')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { kind: 'no_org' }

  const [{ data: org }, { data: b2b }, { data: stores }, { data: profile }] = await Promise.all([
    admin.from('organizations')
      .select('id, name, customer_code')
      .eq('id', membership.organization_id).single(),
    admin.from('b2b_accounts')
      .select('id, tier_level, payment_terms, default_deposit_percent, contract_notes, tenant_type, pricing_mode')
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
      membershipId: membership.id,
      role: ((membership as { role?: string }).role === 'staff' ? 'staff' : 'org_admin'),
      email: profile?.email ?? user.email ?? '',
      fullName: profile?.full_name ?? '',
      organizationId: org.id,
      organizationName: org.name,
      customerCode: org.customer_code,
      b2bAccountId: b2b?.id ?? null,
      tierLevel: b2b?.tier_level ?? null,
      paymentTerms: b2b?.payment_terms ?? null,
      contractNotes: (b2b as { contract_notes?: string | null } | null)?.contract_notes ?? null,
      pricingMode: (b2b as { pricing_mode?: string | null } | null)?.pricing_mode ?? null,
      defaultDepositPercent: b2b?.default_deposit_percent ?? null,
      storeIds: (stores ?? []).map((s) => s.id),
      defaultStoreId: membership.default_store_id ?? null,
      tenantType: (b2b as { tenant_type?: B2BCustomerContext['tenantType'] } | null)?.tenant_type ?? null,
      allowsMultiStoreOrdering:
        (b2b as { tenant_type?: B2BCustomerContext['tenantType'] } | null)?.tenant_type === 'studio_plus_inventory',
      moqExempt: Boolean((org as { moq_exempt?: boolean | null }).moq_exempt),
      orderingPermission:
        ((membership as { ordering_permission?: string }).ordering_permission as
          | import('@/lib/shop/fulfilment-mode').MemberPermission
          | undefined) ?? 'stock_only',
    } satisfies B2BCustomerContext,
  }
}

export const requireB2BCustomerCached = cache(
  async (requireCustomerCode = false): Promise<RequireB2BCustomerResult> =>
    requireB2BCustomer({ requireCustomerCode }),
)

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
  if (result.context.isPreview) {
    return {
      error: NextResponse.json(
        { error: 'Preview only — nothing was saved.' },
        { status: 403 },
      ),
    }
  }
  return result
}
