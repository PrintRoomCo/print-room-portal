import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  const email = process.env.DEMO_EMAIL
  const password = process.env.DEMO_PASSWORD
  if (!email || !password) {
    return NextResponse.redirect(new URL('/sign-in?error=demo_unavailable', request.url))
  }

  // Land straight in the storefront; pre-set welcome_seen so the interstitial is skipped.
  const response = NextResponse.redirect(new URL('/shop', request.url))
  response.cookies.set('welcome_seen', 'true', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    },
  )

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return NextResponse.redirect(new URL('/sign-in?error=demo_failed', request.url))
  }
  return response
}
