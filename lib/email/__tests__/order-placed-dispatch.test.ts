import { describe, it, expect, vi, beforeEach } from 'vitest'

interface EmailArgs {
  to: string
  subject: string
  html: string
  text: string
}
const sendEmail = vi.fn((args: EmailArgs) => {
  void args
  return Promise.resolve({ success: true, messageId: 'm1' })
})
vi.mock('../client', () => ({
  sendEmail: (a: EmailArgs) => sendEmail(a),
}))

import {
  buildOrderPlacedDispatchEmail,
  sendOrderPlacedDispatch,
  type OrderPlacedDispatchParams,
} from '../order-placed-dispatch'

const params: OrderPlacedDispatchParams = {
  to: 'charlotte@theprint-room.co.nz',
  orderRef: 'TPRC-000042',
  customerName: 'Anytime Fitness',
  orderType: 'stock_on_hand',
  totalAmount: 349.5,
  orderUrl: 'https://portal.theprintroom.nz/checkout/confirmation/ord-1',
  lines: [{ productName: 'Classic Tee', variantLabel: 'Black / M', quantity: 10, unitPrice: 34.95 }],
}

describe('buildOrderPlacedDispatchEmail', () => {
  it('renders ref, deep link, line summary, total and order type', () => {
    const { subject, html, text } = buildOrderPlacedDispatchEmail(params)
    expect(subject).toContain('TPRC-000042')
    expect(html).toContain('TPRC-000042')
    expect(html).toContain('https://portal.theprintroom.nz/checkout/confirmation/ord-1')
    expect(html).toContain('Classic Tee')
    expect(html).toContain('$349.50')
    expect(html).toContain('Stock on hand')
    expect(text).toContain('Open order: https://portal.theprintroom.nz/checkout/confirmation/ord-1')
  })
})

describe('sendOrderPlacedDispatch', () => {
  beforeEach(() => sendEmail.mockClear())
  it('sends to the provided recipient with the built subject', async () => {
    await sendOrderPlacedDispatch(params)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const arg = sendEmail.mock.calls[0][0]
    expect(arg.to).toBe('charlotte@theprint-room.co.nz')
    expect(arg.subject).toContain('TPRC-000042')
  })
})
