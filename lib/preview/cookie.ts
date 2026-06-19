import { cookies } from 'next/headers'
import { signPreviewToken, verifyPreviewToken, type PreviewPayload } from '@/lib/preview/token'

export const PREVIEW_COOKIE = 'pr_preview'
export const SESSION_TTL_SEC = 30 * 60

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SEC,
}

function secret(): string {
  const s = process.env.PREVIEW_TOKEN_SECRET
  if (!s) throw new Error('PREVIEW_TOKEN_SECRET is not set')
  return s
}

/** Re-sign a verified launch payload as a 30-min session token (for the cookie). */
export function buildSessionToken(launch: PreviewPayload, nowSec: number): string {
  const session: PreviewPayload = {
    ...launch,
    purpose: 'preview-session',
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SEC,
  }
  return signPreviewToken(session, secret())
}

/** Read + verify the preview-session cookie. Returns null when absent/invalid/expired. */
export async function readPreviewSession(nowSec: number): Promise<PreviewPayload | null> {
  const store = await cookies()
  const raw = store.get(PREVIEW_COOKIE)?.value
  if (!raw) return null
  return verifyPreviewToken(raw, secret(), nowSec, 'preview-session')
}
