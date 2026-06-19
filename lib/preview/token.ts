import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface PreviewTarget { kind: 'member'; membershipId: string }
export interface PreviewPayload {
  v: 1
  org: string
  target: PreviewTarget
  itemId?: string
  productId?: string
  purpose: 'preview' | 'preview-session'
  iat: number
  exp: number
  nonce: string
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}
function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

export function newNonce(): string {
  return randomBytes(12).toString('base64url')
}

export function signPreviewToken(payload: PreviewPayload, secret: string): string {
  const body = b64urlEncode(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyPreviewToken(
  token: string,
  secret: string,
  nowSec: number,
  expectedPurpose: PreviewPayload['purpose'],
): PreviewPayload | null {
  const dot = token.indexOf('.')
  if (dot <= 0 || token.indexOf('.', dot + 1) !== -1) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expectedSig = createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: PreviewPayload
  try {
    payload = JSON.parse(b64urlDecode(body)) as PreviewPayload
  } catch {
    return null
  }
  if (payload.v !== 1) return null
  if (payload.purpose !== expectedPurpose) return null
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) return null
  if (!payload.org || payload.target?.kind !== 'member' || !payload.target.membershipId) return null
  return payload
}
