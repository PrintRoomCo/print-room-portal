import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseMiddlewareClient } from '@/lib/supabase-middleware'

/**
 * Next.js proxy (formerly middleware):
 * 1. Refreshes the Supabase session on every request (keeps cookies alive)
 * 2. Redirects unauthenticated users away from portal routes to /sign-in
 * 3. Redirects authenticated users away from auth routes to /account
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })
  const supabase = createSupabaseMiddlewareClient(request, response)

  // getUser() refreshes the session and returns the current user
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // Protected portal routes — redirect to sign-in if no session
  const portalRoutes = ['/account', '/order-tracker', '/my-collections']
  const isPortalRoute = portalRoutes.some((route) => path.startsWith(route))

  if (isPortalRoute && !user) {
    const signInUrl = new URL('/sign-in', request.url)
    signInUrl.searchParams.set('returnTo', path)
    return NextResponse.redirect(signInUrl)
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
    '/order-tracker/:path*',
    '/my-collections/:path*',
    '/sign-in',
    '/request-access',
  ],
}
