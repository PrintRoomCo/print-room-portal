import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * GET /callback
 * Supabase PKCE callback — exchanges auth code for session.
 * Handles password reset redirects and sign-in callbacks.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const upstreamError = searchParams.get('error') ?? searchParams.get('error_code')
  const upstreamErrorDescription = searchParams.get('error_description')
  const next = searchParams.get('next') ?? '/account'

  if (upstreamError) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?error=${encodeURIComponent(upstreamError)}&error_description=${encodeURIComponent(upstreamErrorDescription ?? 'Invite or sign-in link is invalid or has already been used. Request a fresh one.')}`,
        request.url,
      ),
    )
  }

  const response = NextResponse.redirect(new URL(next, request.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        new URL(`/sign-in?error=callback_error&error_description=${encodeURIComponent(error.message)}`, request.url)
      )
    }
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'recovery' | 'email' | 'invite' | 'magiclink' | 'signup' | 'email_change',
    })
    if (error) {
      return NextResponse.redirect(
        new URL(`/sign-in?error=verification_error&error_description=${encodeURIComponent(error.message)}`, request.url)
      )
    }
    if (type === 'recovery') {
      return NextResponse.redirect(new URL('/set-password', request.url))
    }
    if (type === 'invite') {
      return NextResponse.redirect(new URL('/set-password?invite=1', request.url))
    }
  } else {
    // No query-param tokens. Tokens may live in the URL fragment (implicit flow)
    // which the server cannot read. Forward to a client page that reads the
    // fragment and finishes the session.
    const resolveUrl = new URL('/auth-resolve', request.url)
    resolveUrl.searchParams.set('next', next)
    return NextResponse.redirect(resolveUrl)
  }

  return response
}
