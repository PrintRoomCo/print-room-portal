import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'

interface SendBody {
  userIds?: string[]
}

interface SendRowResult {
  user_id: string
  email: string | null
  status: 'sent' | 'failed'
  reason?: string
}

// Deferred-send half of the self-serve invite flow: POST /api/team/invite
// provisions members with invited_at NULL; this endpoint emails them the
// branded sign-in OTP in a batch and stamps invited_at. Mirrors the staff
// portal's /api/b2b-accounts/[id]/invites/send, org-scoped to the caller.
export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  if (auth.context.role !== 'org_admin') {
    return NextResponse.json(
      { error: 'Only organisation admins can send invites' },
      { status: 403 },
    )
  }

  const admin = auth.admin
  const orgId = auth.context.organizationId

  let body: SendBody = {}
  try {
    body = (await request.json()) as SendBody
  } catch {
    // empty body allowed → send to everyone not yet emailed
  }

  // Resolve targets INSIDE this org only. Explicit ids are intersected with
  // the org's memberships so an admin can never fire an OTP email at a user
  // outside their organisation; explicit ids may re-send to already-invited
  // members (lost email), the default path targets invited_at IS NULL only.
  const base = admin
    .from('user_organizations')
    .select('user_id')
    .eq('organization_id', orgId)
  const { data: memberships } =
    Array.isArray(body.userIds) && body.userIds.length > 0
      ? await base.in('user_id', body.userIds)
      : await base.is('invited_at', null)
  const targetIds = (memberships ?? []).map((m: { user_id: string }) => m.user_id)

  if (targetIds.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, rows: [] }, { status: 200 })
  }

  const { data: profiles } = await admin.from('profiles').select('id, email').in('id', targetIds)
  const emailById = new Map<string, string | null>(
    (profiles ?? []).map((p: { id: string; email: string | null }) => [p.id, p.email]),
  )

  const redirectBase = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://portal.theprintroom.nz'
  const rows: SendRowResult[] = []
  let sent = 0
  let failed = 0

  // Sequential — stays under GoTrue email rate limits (mirrors the staff bulk send).
  for (const userId of targetIds) {
    const email = emailById.get(userId) ?? null
    if (!email) {
      failed++
      rows.push({ user_id: userId, email, status: 'failed', reason: 'No email on file' })
      continue
    }
    const { error: otpError } = await admin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${redirectBase}/callback?next=/welcome`,
        data: { invited_org_id: orgId },
      },
    })
    if (otpError) {
      failed++
      rows.push({ user_id: userId, email, status: 'failed', reason: otpError.message })
      continue
    }
    await admin
      .from('user_organizations')
      .update({ invited_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('user_id', userId)
    await recordAuditEvent({
      orgId,
      actorUserId: auth.context.userId,
      action: AUDIT_ACTIONS.MEMBER_INVITE,
      targetType: 'user',
      targetId: userId,
      metadata: { email, via: 'self_serve_bulk_send' },
    })
    sent++
    rows.push({ user_id: userId, email, status: 'sent' })
  }

  return NextResponse.json({ sent, failed, rows }, { status: 200 })
}
