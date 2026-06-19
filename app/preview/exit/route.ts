import { NextResponse, type NextRequest } from 'next/server'
import { PREVIEW_COOKIE, sessionCookieOptions } from '@/lib/preview/cookie'

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', req.nextUrl.origin))
  res.cookies.set(PREVIEW_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
  return res
}
