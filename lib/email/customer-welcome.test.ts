import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_WELCOME_SUBJECT,
  buildCustomerWelcomeEmail,
} from '@/lib/email/customer-welcome'

const OPTS = {
  firstName: 'Jessie',
  orgName: 'Acme Corp',
  signInUrl: 'https://shop.example.test/sign-in',
} as const

describe('buildCustomerWelcomeEmail', () => {
  it('returns the exact subject, an html body, and a plain-text alternative', () => {
    const email = buildCustomerWelcomeEmail(OPTS)
    expect(email.subject).toBe(CUSTOMER_WELCOME_SUBJECT)
    expect(CUSTOMER_WELCOME_SUBJECT).toBe('Welcome to The Print Room portal')
    expect(email.html.length).toBeGreaterThan(0)
    expect(email.text.length).toBeGreaterThan(0)
  })

  it('personalises with the first name and org name', () => {
    const { html } = buildCustomerWelcomeEmail(OPTS)
    expect(html).toContain('Jessie')
    expect(html).toContain('Acme Corp')
  })

  it('points the only CTA at the sign-in URL', () => {
    const { html } = buildCustomerWelcomeEmail(OPTS)
    expect(html).toContain('href="https://shop.example.test/sign-in"')
  })

  it('contains no 6-digit code affordance and no Supabase token placeholder', () => {
    const { html, text } = buildCustomerWelcomeEmail(OPTS)
    expect(html).not.toContain('{{ .Token }}')
    // No standalone 6-digit code. Exclude hex colours (e.g. #222222) which are
    // legitimate styling, not a sign-in code — assert against the plain text too.
    expect(html).not.toMatch(/(?<!#)\b\d{6}\b/)
    expect(text).not.toMatch(/\b\d{6}\b/)
  })

  it('escapes html in interpolated values', () => {
    const { html } = buildCustomerWelcomeEmail({
      firstName: '<b>x</b>',
      orgName: 'A & B',
      signInUrl: 'https://shop.example.test/sign-in',
    })
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('A &amp; B')
  })

  it('degrades gracefully when first name and org name are absent', () => {
    const { html, text } = buildCustomerWelcomeEmail({
      signInUrl: 'https://shop.example.test/sign-in',
    })
    expect(html).toContain('Welcome')
    expect(html).toContain('The Print Room portal')
    expect(text).toContain('Welcome')
  })
})
