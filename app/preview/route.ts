import { NextResponse, type NextRequest } from 'next/server'
import { verifyPreviewToken } from '@/lib/preview/token'
import { buildSessionToken, PREVIEW_COOKIE, sessionCookieOptions } from '@/lib/preview/cookie'

export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin
  const token = req.nextUrl.searchParams.get('token')
  const secret = process.env.PREVIEW_TOKEN_SECRET

  if (!token || !secret) {
    return NextResponse.redirect(new URL('/preview/expired', base))
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const payload = verifyPreviewToken(token, secret, nowSec, 'preview')
  if (!payload) {
    return NextResponse.redirect(new URL('/preview/expired', base))
  }

  const dest = payload.productId ? `/catalogue/${payload.productId}` : '/catalogue'
  const res = NextResponse.redirect(new URL(dest, base))
  res.cookies.set(PREVIEW_COOKIE, buildSessionToken(payload, nowSec), sessionCookieOptions)
  return res
}
