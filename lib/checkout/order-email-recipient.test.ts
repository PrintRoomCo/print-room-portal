import { describe, it, expect } from 'vitest'
import { resolveOrderEmailRecipient } from './order-email-recipient'

describe('resolveOrderEmailRecipient', () => {
  it('routes test-org orders to the test inbox, never the customer', () => {
    expect(resolveOrderEmailRecipient({
      isTestOrg: true, customerEmail: 'real.customer@example.com', testEmail: 'jamie@theprint-room.co.nz',
    })).toBe('jamie@theprint-room.co.nz')
  })
  it('sends real-org orders to the customer', () => {
    expect(resolveOrderEmailRecipient({
      isTestOrg: false, customerEmail: 'real.customer@example.com', testEmail: 'jamie@theprint-room.co.nz',
    })).toBe('real.customer@example.com')
  })
})
