import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { buildStoreGrantDiff } from '@/lib/orders/branch-grants'

// Customer-portal mirror of the staff store-grants replace-set route. org_admin-only,
// own-org only: the org id comes from the authenticated admin's membership (context),
// NEVER the URL, and every store/membership must belong to that org. This is a
// privilege-granting surface, so both org-scoping checks are mandatory.

export interface StoreGrantRow {
  id: string
  name: string
  granted: boolean
}
export interface StoreGrantsResponse {
  stores: StoreGrantRow[]
}

interface RouteParams {
  params: Promise<{ membershipId: string }>
}

async function loadStoreGrants(
  admin: SupabaseClient,
  orgId: string,
  membershipId: string,
): Promise<StoreGrantsResponse | null> {
  const { data: membership } = await admin
    .from('user_organizations')
    .select('id')
    .eq('id', membershipId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return null

  const [{ data: stores }, { data: grants }] = await Promise.all([
    admin
      .from('stores')
      .select('id, name')
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
    admin.from('b2b_member_store_grants').select('store_id').eq('membership_id', membershipId),
  ])
  const granted = new Set((grants ?? []).map((g) => g.store_id as string))
  return {
    stores: (stores ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      granted: granted.has(s.id as string),
    })),
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  if (auth.context.role !== 'org_admin') {
    return NextResponse.json({ error: 'Only organisation admins can manage branches' }, { status: 403 })
  }
  const { membershipId } = await params
  const out = await loadStoreGrants(auth.admin, auth.context.organizationId, membershipId)
  if (!out) {
    return NextResponse.json({ error: 'Membership not found for this organization' }, { status: 404 })
  }
  return NextResponse.json(out)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  if (auth.context.role !== 'org_admin') {
    return NextResponse.json({ error: 'Only organisation admins can manage branches' }, { status: 403 })
  }
  const { admin, context } = auth
  const orgId = context.organizationId
  const { membershipId } = await params

  // (a) target membership must belong to the admin's OWN org.
  const { data: membership } = await admin
    .from('user_organizations')
    .select('id')
    .eq('id', membershipId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Membership not found for this organization' }, { status: 404 })
  }

  let body: { storeIds: string[] }
  try {
    body = (await request.json()) as { storeIds: string[] }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.storeIds)) {
    return NextResponse.json({ error: 'storeIds must be an array' }, { status: 400 })
  }

  // (b) every store must belong to the admin's own org.
  const { data: orgStores } = await admin.from('stores').select('id').eq('organization_id', orgId)
  const orgStoreIds = new Set((orgStores ?? []).map((s) => s.id as string))
  const desired = [...new Set(body.storeIds)]
  for (const sid of desired) {
    if (!orgStoreIds.has(sid)) {
      return NextResponse.json(
        { error: `Store ${sid} does not belong to this organization` },
        { status: 422 },
      )
    }
  }

  const before = await loadStoreGrants(admin, orgId, membershipId)
  const { data: existing } = await admin
    .from('b2b_member_store_grants')
    .select('store_id')
    .eq('membership_id', membershipId)
  const existingIds = (existing ?? []).map((r) => r.store_id as string)
  const { toInsert, toDelete } = buildStoreGrantDiff(existingIds, desired)

  if (toDelete.length > 0) {
    const { error } = await admin
      .from('b2b_member_store_grants')
      .delete()
      .eq('membership_id', membershipId)
      .in('store_id', toDelete)
    if (error) return NextResponse.json({ error: error.message, step: 'delete' }, { status: 500 })
  }
  if (toInsert.length > 0) {
    const { error } = await admin
      .from('b2b_member_store_grants')
      .insert(
        toInsert.map((store_id) => ({
          membership_id: membershipId,
          store_id,
          granted_by: context.userId,
        })),
      )
    if (error) return NextResponse.json({ error: error.message, step: 'insert' }, { status: 500 })
  }

  const after = await loadStoreGrants(admin, orgId, membershipId)
  await recordAuditEvent({
    orgId,
    actorUserId: context.userId,
    action: AUDIT_ACTIONS.B2B_MEMBER_STORE_GRANTS_CHANGE,
    targetType: 'user_organizations',
    targetId: membershipId,
    metadata: { diff: { added: toInsert, removed: toDelete }, before, after },
  })
  return NextResponse.json(after)
}
