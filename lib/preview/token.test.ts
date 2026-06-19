import { describe, it, expect } from 'vitest'
import { signPreviewToken, verifyPreviewToken, newNonce, type PreviewPayload } from './token'

const SECRET = 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaa'
const NOW = 1_000_000

function launch(over: Partial<PreviewPayload> = {}): PreviewPayload {
  return {
    v: 1,
    org: 'org-1',
    target: { kind: 'member', membershipId: 'mem-1' },
    purpose: 'preview',
    iat: NOW,
    exp: NOW + 600,
    nonce: 'n1',
    ...over,
  }
}

describe('preview token', () => {
  it('round-trips a valid token', () => {
    const t = signPreviewToken(launch(), SECRET)
    expect(verifyPreviewToken(t, SECRET, NOW, 'preview')).toMatchObject({ org: 'org-1' })
  })
  it('rejects a tampered body', () => {
    const t = signPreviewToken(launch(), SECRET)
    const tampered = 'x' + t.slice(1)
    expect(verifyPreviewToken(tampered, SECRET, NOW, 'preview')).toBeNull()
  })
  it('rejects a wrong secret', () => {
    const t = signPreviewToken(launch(), SECRET)
    expect(verifyPreviewToken(t, 'other-secret', NOW, 'preview')).toBeNull()
  })
  it('rejects an expired token', () => {
    const t = signPreviewToken(launch({ exp: NOW - 1 }), SECRET)
    expect(verifyPreviewToken(t, SECRET, NOW, 'preview')).toBeNull()
  })
  it('rejects the wrong purpose', () => {
    const t = signPreviewToken(launch(), SECRET)
    expect(verifyPreviewToken(t, SECRET, NOW, 'preview-session')).toBeNull()
  })
  it('rejects malformed input', () => {
    expect(verifyPreviewToken('garbage', SECRET, NOW, 'preview')).toBeNull()
    expect(verifyPreviewToken('a.b.c', SECRET, NOW, 'preview')).toBeNull()
  })
  it('newNonce returns a non-empty string', () => {
    expect(newNonce().length).toBeGreaterThan(0)
  })
})
