import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase'
import { getCompanyAccess } from '@/lib/company'
import type { B2BCustomerContext } from '@/lib/checkout/server'
import type { B2BCustomerAccess } from '@/types/company'
import type { PreviewPayload } from '@/lib/preview/token'

/** Server context (catalogue/PDP/checkout pages) for the previewed member. */
export async function buildPreviewContext(
  admin: SupabaseClient,
  payload: PreviewPayload,
): Promise<{ admin: SupabaseClient; context: B2BCustomerContext } | null> {
  const { data: membership } = await admin
    .from('user_organizations')
    .select('id, user_id, organization_id, default_store_id, role, ordering_permission')
    .eq('id', payload.target.membershipId)
    .maybeSingle()
  if (!membership || membership.organization_id !== payload.org) return null

  // Mirror requireB2BCustomer's selects exactly (note: org select omits moq_exempt).
  const [{ data: org }, { data: b2b }, { data: stores }, { data: profile }] = await Promise.all([
    admin.from('organizations').select('id, name, customer_code').eq('id', membership.organization_id).single(),
    admin.from('b2b_accounts')
      .select('id, tier_level, payment_terms, default_deposit_percent, contract_notes, tenant_type, pricing_mode')
      .eq('organization_id', membership.organization_id).maybeSingle(),
    admin.from('stores').select('id').eq('organization_id', membership.organization_id),
    admin.from('profiles').select('email, full_name').eq('id', membership.user_id).maybeSingle(),
  ])
  if (!org) return null

  const context: B2BCustomerContext = {
    userId: membership.user_id,
    membershipId: membership.id,
    role: ((membership as { role?: string }).role === 'staff' ? 'staff' : 'org_admin'),
    email: profile?.email ?? '',
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
    moqExempt: false,
    orderingPermission:
      ((membership as { ordering_permission?: string }).ordering_permission as
        B2BCustomerContext['orderingPermission'] | undefined) ?? 'stock_only',
    isPreview: true,
    previewItemId: payload.itemId ?? null,
  }
  return { admin, context }
}

/** Client access (CompanyContext → cart key, banner, role-gated UI) for the previewed member. */
export async function buildPreviewAccess(payload: PreviewPayload): Promise<B2BCustomerAccess | null> {
  const admin = getSupabaseServer()
  const { data: membership } = await admin
    .from('user_organizations')
    .select('user_id, organization_id, role, ordering_permission')
    .eq('id', payload.target.membershipId)
    .maybeSingle()
  if (!membership || membership.organization_id !== payload.org) return null

  const { data: profile } = await admin
    .from('profiles').select('full_name').eq('id', membership.user_id).maybeSingle()

  const access = await getCompanyAccess(membership.user_id)
  // getCompanyAccess resolves the user's single membership; guard against a
  // multi-membership user resolving to a different org than the preview target.
  if (!access || access.companyId !== payload.org) return null

  return {
    ...access,
    isPreview: true,
    previewAs: {
      name: profile?.full_name || access.email || 'member',
      role: membership.role === 'staff' ? 'staff' : 'org_admin',
      orderingPermission:
        ((membership.ordering_permission as 'stock_only' | 'reorder_only' | 'both') ?? 'stock_only'),
    },
  }
}
