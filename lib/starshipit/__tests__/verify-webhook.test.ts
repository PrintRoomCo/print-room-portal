import { describe, it, expect } from 'vitest'
import { verifyStarshipitWebhookSecret } from '../verify-webhook'

describe('verifyStarshipitWebhookSecret', () => {
  it('fails closed when no secret is configured (dark by default)', () => {
    expect(verifyStarshipitWebhookSecret({ configuredSecret: undefined, querySecret: 'x', headerSecret: null })).toBe(false)
  })
  it('accepts a matching query secret', () => {
    expect(verifyStarshipitWebhookSecret({ configuredSecret: 's3cret', querySecret: 's3cret', headerSecret: null })).toBe(true)
  })
  it('accepts a matching header secret', () => {
    expect(verifyStarshipitWebhookSecret({ configuredSecret: 's3cret', querySecret: null, headerSecret: 's3cret' })).toBe(true)
  })
  it('rejects a mismatch', () => {
    expect(verifyStarshipitWebhookSecret({ configuredSecret: 's3cret', querySecret: 'nope', headerSecret: null })).toBe(false)
  })
})
