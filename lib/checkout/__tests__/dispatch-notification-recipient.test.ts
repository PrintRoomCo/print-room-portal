import { describe, it, expect, afterEach } from 'vitest'
import {
  resolveDispatchNotificationRecipient,
  isTestOrgFailClosed,
} from '../dispatch-notification-recipient'

const SAVED = { ...process.env }
afterEach(() => {
  process.env = { ...SAVED }
})

describe('resolveDispatchNotificationRecipient', () => {
  it('routes production orders to charlotte@ by default', () => {
    delete process.env.DISPATCH_NOTIFICATION_EMAIL
    expect(
      resolveDispatchNotificationRecipient({ isTestOrg: false, testEmail: 'jamie@theprint-room.co.nz' }),
    ).toBe('charlotte@theprint-room.co.nz')
  })

  it('honours DISPATCH_NOTIFICATION_EMAIL override for production', () => {
    process.env.DISPATCH_NOTIFICATION_EMAIL = 'dispatch@theprint-room.co.nz'
    expect(
      resolveDispatchNotificationRecipient({ isTestOrg: false, testEmail: 'jamie@theprint-room.co.nz' }),
    ).toBe('dispatch@theprint-room.co.nz')
  })

  it('routes test/demo orgs to the test inbox (jamie@), never the dispatch desk', () => {
    process.env.DISPATCH_NOTIFICATION_EMAIL = 'dispatch@theprint-room.co.nz'
    expect(
      resolveDispatchNotificationRecipient({ isTestOrg: true, testEmail: 'jamie@theprint-room.co.nz' }),
    ).toBe('jamie@theprint-room.co.nz')
  })
})

describe('isTestOrgFailClosed', () => {
  it('treats a real org (is_test false) as non-test', () => {
    expect(isTestOrgFailClosed({ data: { is_test: false }, error: null })).toBe(false)
  })

  it('treats a genuine test org (is_test true) as test', () => {
    expect(isTestOrgFailClosed({ data: { is_test: true }, error: null })).toBe(true)
  })

  it('fails closed (test) when the org lookup errors', () => {
    expect(isTestOrgFailClosed({ data: null, error: { message: 'db blip' } })).toBe(true)
  })

  it('fails closed (test) when the org row is missing (null data, no error)', () => {
    expect(isTestOrgFailClosed({ data: null, error: null })).toBe(true)
  })

  it('treats a null/absent is_test value as non-test', () => {
    expect(isTestOrgFailClosed({ data: { is_test: null }, error: null })).toBe(false)
    expect(isTestOrgFailClosed({ data: {}, error: null })).toBe(false)
  })
})
