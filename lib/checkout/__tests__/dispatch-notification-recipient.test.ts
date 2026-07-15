import { describe, it, expect, afterEach } from 'vitest'
import { resolveDispatchNotificationRecipient } from '../dispatch-notification-recipient'

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
