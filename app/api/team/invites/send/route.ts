import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { buildCustomerWelcomeEmail } from '@/lib/email/customer-welcome'
import { sendEmail } from '@/lib/email/client'

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
// branded welcome email (no code, no magic link) in a batch and stamps
// invited_at. Recipients request their own fresh sign-in code at /sign-in.
// Mirrors the staff portal's /api/b2b-accounts/[id]/invites/send, org-scoped.
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
  // outside their organisation. Both paths are staff-only; active profiles are
  // excluded below. Explicit ids may re-send to pending members (lost email),
  // while the default path targets invited_at IS NULL only.
  const base = admin
    .from('user_organizations')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'staff')
  const { data: memberships } =
    Array.isArray(body.userIds) && body.userIds.length > 0
      ? await base.in('user_id', body.userIds)
      : await base.is('invited_at', null)
  const targetIds = (memberships ?? []).map((m: { user_id: string }) => m.user_id)

  if (targetIds.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, rows: [] }, { status: 200 })
  }

  // Org name personalises the welcome email; fetch once for the whole batch.
  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()
  const orgName = org?.name ?? undefined

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, last_sign_in_at')
    .in('id', targetIds)
  const profileById = new Map<
    string,
    { email: string | null; last_sign_in_at: string | null }
  >(
    (profiles ?? []).map(
      (profile: { id: string; email: string | null; last_sign_in_at?: string | null }) => [
        profile.id,
        {
          email: profile.email,
          last_sign_in_at: profile.last_sign_in_at ?? null,
        },
      ],
    ),
  )

  const redirectBase = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://portal.theprintroom.nz'
  const rows: SendRowResult[] = []
  let sent = 0
  let failed = 0

  // Sequential — stays under GoTrue email rate limits (mirrors the staff bulk send).
  for (const userId of targetIds) {
    const profile = profileById.get(userId)
    // A legacy active staff membership can have invited_at NULL. They have
    // already signed in, so silently exclude them from the pending invite batch.
    if (profile?.last_sign_in_at) continue
    const email = profile?.email ?? null
    if (!email) {
      failed++
      rows.push({ user_id: userId, email, status: 'failed', reason: 'No email on file' })
      continue
    }
    const { subject, html, text } = buildCustomerWelcomeEmail({
      orgName,
      signInUrl: `${redirectBase}/sign-in`,
    })
    const welcome = await sendEmail({ to: email, subject, html, text })
    if (!welcome.success) {
      failed++
      rows.push({
        user_id: userId,
        email,
        status: 'failed',
        reason: welcome.error ?? 'Email send failed',
      })
      continue
    }
    // If the stamp fails, the welcome email already went out but invited_at stays NULL —
    // the member would be re-emailed on every future batch send. Surface it as
    // a failure so the admin sees it rather than silently double-sending.
    const { error: stampError } = await admin
      .from('user_organizations')
      .update({ invited_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('user_id', userId)
    if (stampError) {
      failed++
      rows.push({
        user_id: userId,
        email,
        status: 'failed',
        reason: `Email sent but the invited_at stamp failed: ${stampError.message}`,
      })
      continue
    }
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
