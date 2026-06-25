import { NextResponse } from 'next/server'

/**
 * Monday.com Webhook: Account Approved — RETIRED 2026-06-25.
 *
 * This endpoint previously created a Supabase auth user and sent a
 * `resetPasswordForEmail` email when a Monday account-request was approved.
 * It was both dead and broken:
 *   - `account_requests` held a single row (993 auth.users existed) — not the
 *     live onboarding path.
 *   - the success branch wrote `account_requests.approved_at`, a column that
 *     does not exist, so the UPDATE threw.
 * It also duplicated auth onboarding (a third email sender).
 *
 * B2B members are now onboarded through the staff portal invite flow, which
 * sends exactly ONE branded "sign-in code" email (Supabase OTP). If self-signup
 * approval is ever wanted again, rebuild it on that SAME OTP flow — not
 * `createUser` + `resetPasswordForEmail`.
 *
 * Kept as a safe no-op (still answering Monday's challenge handshake) so the
 * webhook registration doesn't error or retry. Performs NO auth writes.
 */
export async function POST(request: Request) {
  let payload: { challenge?: string }
  try {
    payload = (await request.json()) as { challenge?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Monday verification handshake — echo the challenge so the webhook stays registered.
  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge })
  }

  return NextResponse.json({
    success: true,
    message:
      'account-approved webhook retired — B2B onboarding is handled by the staff invite flow (single branded sign-in code).',
  })
}

export async function GET() {
  return NextResponse.json({
    message: 'Monday.com account-approved webhook (retired no-op)',
  })
}
