import { describe, it, expect, vi, beforeEach } from 'vitest'

interface EmailArgs {
  to: string
  subject: string
  html: string
  text: string
}

const sendEmail = vi.fn(() => Promise.resolve({ success: true }))
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

  it('in-production: milestone subject/heading, no tracking block', async () => {
    await sendTrackerStatusEmail({
      contactEmail: 'buyer@acme.test',
      trackerToken: 'tok-1',
      jobReference: 'TPRC-000037',
      newStatus: 'in-production',
    })
    const { subject, html } = sendEmail.mock.calls[0][0]
    expect(subject).toBe('Your order is in production — TPRC-000037')
    expect(html).toContain('Your order is in production')
    expect(html).not.toContain('Track with carrier')
  })

  it('dispatched with tracking: shipped subject + tracking block', async () => {
    await sendTrackerStatusEmail({
      contactEmail: 'buyer@acme.test',
      trackerToken: 'tok-1',
      jobReference: 'TPRC-000037',
      newStatus: 'dispatched',
      trackingNumber: '1234567890',
      trackingUrl: 'https://nzpost.co.nz/track/1234567890',
      carrier: 'NZ Post',
    })
    const { subject, html } = sendEmail.mock.calls[0][0]
    expect(subject).toBe('Your order has shipped — TPRC-000037')
    expect(html).toContain('Your order has shipped')
    expect(html).toContain('Track with carrier')
    expect(html).toContain('https://nzpost.co.nz/track/1234567890')
    expect(html).toContain('NZ Post')
  })

  it('dispatched without tracking: shows a "tracking to follow" note, no tracking block', async () => {
    await sendTrackerStatusEmail({
      contactEmail: 'buyer@acme.test',
      trackerToken: 'tok-1',
      jobReference: 'TPRC-000037',
      newStatus: 'dispatched',
    })
    const { html, text } = sendEmail.mock.calls[0][0]
    expect(html).not.toContain('Track with carrier')
    expect(html.toLowerCase()).toContain('tracking details will follow')
    expect(text.toLowerCase()).toContain('tracking details will follow')
  })
})
