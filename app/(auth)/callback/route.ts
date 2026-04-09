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
  const next = searchParams.get('next') ?? '/account'

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
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as 'recovery' | 'email' })
    if (error) {
      return NextResponse.redirect(
        new URL(`/sign-in?error=verification_error&error_description=${encodeURIComponent(error.message)}`, request.url)
      )
    }
    // For recovery, redirect to set-password page
    if (type === 'recovery') {
      return NextResponse.redirect(new URL('/set-password', request.url))
    }
  } else {
    return NextResponse.redirect(
      new URL('/sign-in?error=no_code', request.url)
    )
  }

  return response
}
