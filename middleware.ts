import { NextRequest, NextResponse } from 'next/server'

/**
 * Forwards the request pathname as `x-pathname` so server components can read it
 * (Next.js doesn't expose the request URL to RSCs except via headers set here).
 *
 * Used by `handleAuthFailure` to construct `/sign-in?returnTo=<currentPath>`
 * redirects that send customers back where they started after sign-in.
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
