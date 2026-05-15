import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseMiddlewareClient } from '@/lib/supabase-middleware'

/**
 * Next.js proxy (formerly middleware):
 * 1. Refreshes the Supabase session on every request (keeps cookies alive)
 * 2. Redirects unauthenticated users away from portal routes to /sign-in
 * 3. Redirects authenticated users away from auth routes to /account
 */
export async function proxy(request: NextRequest) {
  // Forward the pathname as `x-pathname` so server components can read it
  // (Next doesn't expose request URL to RSCs except via headers set here).
  // Used by `handleAuthFailure` to build /sign-in?returnTo=<currentPath> for
  // any route the proxy matcher doesn't already cover.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  const supabase = createSupabaseMiddlewareClient(request, response)

  // getUser() refreshes the session and returns the current user
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // Protected portal routes — redirect to sign-in if no session
  const portalRoutes = [
    '/account',
    '/cart',
    '/catalogue',
    '/checkout',
    '/inventory',
    '/my-collections',
    '/order-tracker',
    '/projects', // legacy alias; redirected to /tracking via next.config.ts
    '/tracking',
    '/proofs',
    '/quote-requests',
    '/shop',
    '/welcome',
  ]
  const isPortalRoute = portalRoutes.some((route) => path.startsWith(route))

  if (isPortalRoute && !user) {
    const signInUrl = new URL('/sign-in', request.url)
    signInUrl.searchParams.set('returnTo', path)
    return NextResponse.redirect(signInUrl)
  }

  if (
    isPortalRoute &&
    user &&
    path !== '/welcome' &&
    request.cookies.get('welcome_seen')?.value !== 'true'
  ) {
    return NextResponse.redirect(new URL('/welcome', request.url))
  }

  if (path === '/welcome' && user && request.cookies.get('welcome_seen')?.value !== 'true') {
    response.cookies.set('welcome_seen', 'true', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
  }

  // Auth routes — redirect to account if already signed in
  const authRoutes = ['/sign-in', '/request-access']
  const isAuthRoute = authRoutes.some((route) => path === route)

  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL('/account', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/account/:path*',
    '/cart/:path*',
    '/catalogue/:path*',
    '/checkout/:path*',
    '/inventory/:path*',
    '/order-tracker/:path*',
    '/projects/:path*',
    '/tracking/:path*',
    '/proofs/:path*',
    '/quote-requests/:path*',
    '/shop/:path*',
    '/welcome',
    '/my-collections/:path*',
    '/sign-in',
    '/request-access',
  ],
}
