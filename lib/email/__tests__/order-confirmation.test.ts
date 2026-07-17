import { describe, it, expect, vi } from 'vitest'

// The module imports the Supabase admin client for its audit-log write. The
// pure builder under test never touches it, but mock it so importing the
// module needs no live env.
vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: () => ({ from: () => ({ insert: async () => ({}) }) }),
}))

import { buildOrderConfirmationEmail } from '../order-confirmation'

const baseParams = {
  to: 'buyer@acme.test',
  customerName: 'Sam Rivera',
  orderId: 'ord-1',
  orderRef: 'TPRC-000042',
  totalAmount: 432.5,
  requiredBy: null,
  lines: [
    { productName: 'Staple Tee', variantLabel: 'Ecru / M', quantity: 10, unitPrice: 24.0 },
    { productName: 'Crew Hoodie', variantLabel: 'Black / L', quantity: 3, unitPrice: 64.17 },
  ],
}

describe('buildOrderConfirmationEmail', () => {
  it('keeps the transactional subject contract', () => {
    const { subject } = buildOrderConfirmationEmail(baseParams)
    expect(subject).toBe('Order received - TPRC-000042')
  })

  it('renders the Peaceful-Engineering brand shell', () => {
    const { html } = buildOrderConfirmationEmail(baseParams)
    // Single electric-blue accent + full-bleed blue footer.
    expect(html).toContain('#0600ff')
    expect(html).toContain('background-color:#0600ff')
    // Customer-portal-hosted logo (not the staff domain).
    expect(html).toContain('https://portal.theprintroom.nz/print-room-logo.png')
    expect(html).not.toContain('staff.theprintroom.nz')
    // Grotesque type + the order reference.
    expect(html).toContain('Neuzeit Grotesk')
    expect(html).toContain('TPRC-000042')
    // No leftovers from the old cream template.
    expect(html).not.toContain('#f5f2ed')
    expect(html).not.toContain('THE PRINT ROOM')
  })

  it('renders every line item and the total', () => {
    const { html } = buildOrderConfirmationEmail(baseParams)
    expect(html).toContain('Staple Tee')
    expect(html).toContain('Ecru / M')
    expect(html).toContain('Crew Hoodie')
    expect(html).toContain('$432.50')
  })

  it('escapes HTML in customer-supplied values', () => {
    const { html } = buildOrderConfirmationEmail({
      ...baseParams,
      customerName: '<script>alert(1)</script>',
      lines: [{ productName: 'Tee <b>x</b>', variantLabel: 'M', quantity: 1, unitPrice: 1 }],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Tee &lt;b&gt;x&lt;/b&gt;')
  })

  it('never mentions payment terms', () => {
    // The confirmation deliberately states no terms — the invoice carries them.
    // This guards the removal; the section must not creep back in.
    const { html, text } = buildOrderConfirmationEmail(baseParams)
    expect(html).not.toContain('Payment terms')
    expect(text).not.toContain('Payment terms')
    // The old copy for every terms value the builder used to format.
    for (const copy of ['Net 30 days', 'Net 20 days', 'Prepaid (100% upfront)', 'Contract terms', 'as per agreement']) {
      expect(html).not.toContain(copy)
      expect(text).not.toContain(copy)
    }
  })

  it('never renders a Required-by line, even when a date is supplied', () => {
    // Chris: payment is 20th of month following delivery, so a "required by"
    // date on the confirmation is misleading. Suppressed regardless of input.
    const { html, text } = buildOrderConfirmationEmail({
      ...baseParams,
      requiredBy: 'Fri 18 July',
    })
    expect(html).not.toContain('Required by')
    expect(html).not.toContain('Fri 18 July')
    expect(text).not.toContain('Required by')
  })

  it('renders the provisional-pricing note when a period close is supplied', () => {
    const { html, text } = buildOrderConfirmationEmail({
      ...baseParams,
      provisionalUntil: '2026-07-15T00:00:00.000Z',
    })
    expect(html).toContain('provisional')
    expect(text).toContain('provisional')
  })

  it('ships a plain-text alternative with the contact + reference', () => {
    const { text } = buildOrderConfirmationEmail(baseParams)
    expect(text).toContain('hello@theprint-room.co.nz')
    expect(text).toContain('TPRC-000042')
    expect(text).toContain('Total: $432.50')
  })
})
