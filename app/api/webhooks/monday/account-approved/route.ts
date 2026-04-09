import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

interface MondayWebhookPayload {
  event?: {
    type: string
    boardId: number
    pulseId: number
    pulseName: string
    columnId: string
    columnType: string
    value: {
      label?: {
        index: number
        text: string
      }
    }
    previousValue?: {
      label?: {
        index: number
        text: string
      }
    }
  }
  challenge?: string
}

/**
 * Monday.com Webhook: Account Approved
 *
 * When an account request status changes to "approved" on the Monday board,
 * this webhook creates a Supabase auth user and sends a password setup email.
 */
export async function POST(request: Request) {
  let payload: MondayWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Monday challenge handshake
  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge })
  }

  const { event } = payload
  if (!event) {
    return NextResponse.json({ error: 'No event' }, { status: 400 })
  }

  // Only handle status column changes
  if (event.columnType !== 'color' && event.columnId !== 'status') {
    return NextResponse.json({ success: true, message: 'Ignored — not a status change' })
  }

  const statusText = (event.value?.label?.text || '').toLowerCase().trim()
  const isApproved = ['approved', 'done', 'complete', 'completed'].includes(statusText)

  if (!isApproved) {
    return NextResponse.json({ success: true, message: 'Ignored — not an approval' })
  }

  const mondayItemId = String(event.pulseId)
  const supabase = getSupabaseServer()

  // Find the account request linked to this Monday item
  const { data: accountRequest, error: findError } = await supabase
    .from('account_requests')
    .select('*')
    .eq('monday_item_id', mondayItemId)
    .single()

  if (findError || !accountRequest) {
    // Try matching by pulse name (company - name format)
    console.log('[AccountApproved] No request found for Monday item:', mondayItemId)
    return NextResponse.json({ success: true, message: 'Account request not linked' })
  }

  if (accountRequest.status === 'approved') {
    return NextResponse.json({ success: true, message: 'Already approved' })
  }

  // Create Supabase auth user via admin API
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // Check if user already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers()
    const existing = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === accountRequest.email.toLowerCase()
    )

    if (!existing) {
      // Create user with a random password — they'll set their own via reset link
      const tempPassword = crypto.randomUUID() + crypto.randomUUID()
      const { error: createError } = await adminClient.auth.admin.createUser({
        email: accountRequest.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: accountRequest.full_name,
          company_name: accountRequest.company_name,
        },
      })

      if (createError) {
        console.error('[AccountApproved] Failed to create user:', createError)
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
      }
    }

    // Send password reset email so the user can set their password
    const { error: resetError } = await adminClient.auth.resetPasswordForEmail(
      accountRequest.email,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'}/set-password`,
      }
    )

    if (resetError) {
      console.error('[AccountApproved] Failed to send reset email:', resetError)
    }

    // Update account request status
    await supabase
      .from('account_requests')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', accountRequest.id)

    console.log('[AccountApproved] Account approved for:', accountRequest.email)

    return NextResponse.json({
      success: true,
      message: 'Account approved and setup email sent',
      email: accountRequest.email,
    })
  } catch (error) {
    console.error('[AccountApproved] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Monday.com account-approved webhook endpoint' })
}
