import { describe, it, expect, vi, beforeEach } from 'vitest'

interface EmailArgs {
  to: string
  subject: string
  html: string
  text: string
}

const sendEmail = vi.fn((_args: EmailArgs) => Promise.resolve({ success: true }))
vi.mock('../client', () => ({
  sendEmail: (args: EmailArgs) => sendEmail(args),
}))

import { sendTrackerStatusEmail } from '../tracker-notification'

describe('sendTrackerStatusEmail', () => {
  beforeEach(() => sendEmail.mockClear())

  it('links the CTA to the portal-native /order-tracker/<token> URL', async () => {
    await sendTrackerStatusEmail({
      contactEmail: 'buyer@acme.test',
      trackerToken: 'tok-123',
      jobReference: 'TPRC-000037',
      newStatus: 'in-production',
    })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const { html, text } = sendEmail.mock.calls[0][0]

    const expected = 'https://portal.theprintroom.nz/order-tracker/tok-123'
    expect(html).toContain(expected)
    expect(text).toContain(expected)
    // The retired external proxy URL must be gone.
    expect(html).not.toContain('/apps/order-tracker/job/')
  })
})
