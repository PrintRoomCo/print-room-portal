import { describe, it, expect } from 'vitest'
import { buildOrderConfirmationEmail } from '@/lib/email/order-confirmation'
import { buildOrderPlacedDispatchEmail } from '@/lib/email/order-placed-dispatch'

const confirmationBase = {
  to: 'jamie@theprint-room.co.nz',
  customerName: 'White Fox',
  orderId: 'o1',
  orderRef: 'WFOX-1',
  totalAmount: 100,
  requiredBy: null,
  lines: [{ productName: 'Tee', variantLabel: 'M', quantity: 2, unitPrice: 50 }],
}
const dispatchBase = {
  to: 'jamie@theprint-room.co.nz',
  orderRef: 'WFOX-1',
  customerName: 'White Fox',
  orderType: 'purchase_order' as const,
  totalAmount: 100,
  orderUrl: 'https://x/orders/o1',
  lines: [{ productName: 'Tee', variantLabel: 'M', quantity: 2, unitPrice: 50 }],
}

describe('order emails — AUD currency prefix (AU Stage 1)', () => {
  it('defaults to $ (NZD) — unchanged output', () => {
    expect(buildOrderConfirmationEmail(confirmationBase).text).toContain('$100.00')
    expect(buildOrderConfirmationEmail(confirmationBase).text).not.toContain('A$')
    expect(buildOrderConfirmationEmail(confirmationBase).html).not.toContain('A$')
    expect(buildOrderPlacedDispatchEmail(dispatchBase).text).not.toContain('A$')
    expect(buildOrderPlacedDispatchEmail(dispatchBase).html).not.toContain('A$')
  })
  it('AUD renders A$ on every money figure', () => {
    const c = buildOrderConfirmationEmail({ ...confirmationBase, currency: 'AUD' })
    expect(c.text).toContain('A$100.00')
    expect(c.text).toContain('A$50.00') // line unit price too
    // The dispatch email renders line TOTALS only (no per-unit column in the
    // text body), so A$100.00 covers both the line and the goods value.
    const d = buildOrderPlacedDispatchEmail({ ...dispatchBase, currency: 'AUD' })
    expect(d.text).toContain('A$100.00')
  })
  it('AUD leaves no bare $ money figure behind in either body', () => {
    for (const body of [
      buildOrderConfirmationEmail({ ...confirmationBase, currency: 'AUD' }).text,
      buildOrderPlacedDispatchEmail({ ...dispatchBase, currency: 'AUD' }).text,
    ]) {
      // any "$<digits>" not preceded by an A is an un-prefixed AUD figure
      expect(body).not.toMatch(/(^|[^A])\$\d/)
    }
  })
})
