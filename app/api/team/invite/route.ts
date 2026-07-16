import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { isInvitableRole } from '@/lib/team/invite-guard'
import {
  orderingPermissionOptions,
  defaultOrderingPermission,
  type MemberOrderingPermission,
} from '@/lib/team/ordering-permission'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'

interface InviteBody {
  email?: string
  first_name?: string
  last_name?: string
  default_store_id?: string
  ordering_permission?: string
  role?: string
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  // canManageUsers gate: only org_admins may invite members.
  if (auth.context.role !== 'org_admin') {
    return NextResponse.json(
      { error: 'Only organisation admins can invite members' },
      { status: 403 },
    )
  }

  let body: InviteBody
  try {
    body = (await request.json()) as InviteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const tenantType = auth.context.tenantType
  const email = body.email?.trim().toLowerCase() ?? ''
  const firstName = body.first_name?.trim() ?? ''
  const lastName = body.last_name?.trim() ?? ''
  const defaultStoreId = body.default_store_id?.trim() ?? ''
  const orderingPermission = (body.ordering_permission ?? defaultOrderingPermission(tenantType)) as
    | MemberOrderingPermission
    | string
  // Hard guard: an org_admin can NEVER mint another org_admin. Any body role
  // other than 'staff' is rejected outright; the insert below always writes 'staff'.
  const requestedRole = body.role ?? 'staff'

  if (!validEmail(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }
  if (!firstName) {
    return NextResponse.json({ error: 'First name is required' }, { status: 400 })
  }
  if (!isInvitableRole(requestedRole)) {
    return NextResponse.json(
      { error: 'Org admins can only invite staff members' },
      { status: 403 },
    )
  }
  if (!defaultStoreId) {
    return NextResponse.json(
      { error: 'A default ship-to store is required for staff members' },
      { status: 400 },
    )
  }
  // Tenant-scoped: studios can only reorder (no stock); inventory tenants get all.
  if (!orderingPermissionOptions(tenantType).includes(orderingPermission as MemberOrderingPermission)) {
    return NextResponse.json({ error: 'Invalid ordering permission for this account' }, { status: 400 })
  }

  const admin = auth.admin // service-role client (see requireB2BCustomer)
  const orgId = auth.context.organizationId

  // The chosen store must belong to THIS org — block cross-org tampering.
  const { data: store } = await admin
    .from('stores')
    .select('id')
    .eq('id', defaultStoreId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!store) {
    return NextResponse.json(
      { error: 'Store not found for this organisation' },
      { status: 400 },
    )
  }

  const inviteMetadata = { first_name: firstName, last_name: lastName, invited_org_id: orgId }

  // Provision a PRE-CONFIRMED auth user (no email fires). DEFERRED SEND: unlike
  // the staff single-invite route, we do NOT send the sign-in OTP here and leave
  // invited_at NULL — the member shows as "pending, not yet emailed" and the
  // org admin emails them in a batch via POST /api/team/invites/send.
  let userId: string | null = null
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: inviteMetadata,
  })

  if (createError) {
    const alreadyExists = createError.message.toLowerCase().includes('already')
    if (!alreadyExists) {
      return NextResponse.json({ error: createError.message }, { status: 500 })
    }
    const { data: profileLookup } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    userId = profileLookup?.id ?? null
    if (!userId) {
      const { data: allUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      userId = allUsers?.users.find((u) => u.email === email)?.id ?? null
    }
  } else {
    userId = created.user?.id ?? null
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Could not resolve a user id for the invite' },
      { status: 500 },
    )
  }

  // Don't re-add someone already in this org.
  const { data: existing } = await admin
    .from('user_organizations')
    .select('user_id')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'This user is already a member of your organisation' },
      { status: 409 },
    )
  }

  const { error: membershipError } = await admin.from('user_organizations').insert({
    user_id: userId,
    organization_id: orgId,
    role: 'staff',
    default_store_id: defaultStoreId,
    ordering_permission: orderingPermission,
    // invited_at deliberately left NULL — deferred batch send stamps it.
  })
  if (membershipError) {
    const duplicate = membershipError.code === '23505'
    return NextResponse.json(
      {
        error: duplicate
          ? 'This user is already a member of your organisation'
          : membershipError.message,
      },
      { status: duplicate ? 409 : 500 },
    )
  }

  await recordAuditEvent({
    orgId,
    actorUserId: auth.context.userId,
    action: AUDIT_ACTIONS.MEMBER_INVITE,
    targetType: 'user',
    targetId: userId,
    metadata: {
      email,
      first_name: firstName,
      last_name: lastName,
      role: 'staff',
      default_store_id: defaultStoreId,
      ordering_permission: orderingPermission,
    },
  })

  // email_sent: false — provisioned but not yet emailed (deferred batch send).
  return NextResponse.json({ user_id: userId, email_sent: false }, { status: 201 })
}
