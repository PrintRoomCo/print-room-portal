/**
 * Customer welcome email — sent when a customer-portal user is invited
 * (org_admin or staff/buyer). Branded Peaceful-Engineering-blue shell, no
 * sign-in code and no magic link: the single CTA sends the recipient to the
 * portal sign-in page, where they request their own fresh 6-digit code via the
 * existing "Email code" flow.
 *
 * Mirrors the staff-portal template of the same name — identical copy and
 * signature, differing only in the branded shell it wraps.
 */
import {
  BRAND_ACCENT,
  BRAND_FONT,
  INK,
  MUTED,
  escapeHtml,
  wrapBrandedEmail,
} from './shared'

export const CUSTOMER_WELCOME_SUBJECT = 'Welcome to The Print Room portal'

const PREHEADER = "You're all set up — here's how to log in."

export interface CustomerWelcomeEmailOptions {
  /** Recipient's first name, when known. Greeting degrades to "Welcome" without it. */
  firstName?: string
  /** The organisation they were added to, when known. */
  orgName?: string
  /** Absolute URL to the customer portal sign-in page (e.g. https://portal.theprintroom.nz/sign-in). */
  signInUrl: string
}

export function buildCustomerWelcomeEmail(
  opts: CustomerWelcomeEmailOptions,
): { subject: string; html: string; text: string } {
  const first = opts.firstName?.trim()
  const org = opts.orgName?.trim()
  const greeting = first ? `Welcome, ${escapeHtml(first)}` : 'Welcome'
  const addedLine = org
    ? `You've been added to <strong style="color:${INK};">${escapeHtml(org)}</strong>'s account on The Print Room portal.`
    : `You've been added to The Print Room portal.`

  const body = `
    <div style="padding:8px 0 0;">
      <h1 style="margin:0 0 16px;font-family:${BRAND_FONT};font-size:34px;line-height:1.1;font-weight:700;color:${INK};">${greeting}</h1>
      <p style="margin:0 0 14px;font-family:${BRAND_FONT};font-size:16px;line-height:1.6;color:${MUTED};">${addedLine} From here you can browse your catalogue, place orders, and track your jobs.</p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 10px;">
        <tr>
          <td style="border-radius:9999px;background-color:${BRAND_ACCENT};">
            <a href="${opts.signInUrl}" class="b-link" style="display:inline-block;padding:14px 34px;font-family:${BRAND_FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9999px;">Log in to the portal</a>
          </td>
        </tr>
      </table>

      <p style="margin:14px 0 0;font-family:${BRAND_FONT};font-size:14px;line-height:1.6;color:${MUTED};">When you log in, we'll email you a quick 6-digit code to confirm it's you — no password to remember.</p>
    </div>`

  const html = wrapBrandedEmail(CUSTOMER_WELCOME_SUBJECT, body, {
    preheader: PREHEADER,
    footerNote:
      'Questions about your account? Just reply to this email or contact hello@theprint-room.co.nz.',
  })

  const text = [
    first ? `Welcome, ${first}` : 'Welcome',
    '',
    org
      ? `You've been added to ${org}'s account on The Print Room portal.`
      : `You've been added to The Print Room portal.`,
    'From here you can browse your catalogue, place orders, and track your jobs.',
    '',
    `Log in to the portal: ${opts.signInUrl}`,
    '',
    "When you log in, we'll email you a quick 6-digit code to confirm it's you — no password to remember.",
    '',
    'Questions about your account? Just reply to this email or contact hello@theprint-room.co.nz.',
  ].join('\n')

  return { subject: CUSTOMER_WELCOME_SUBJECT, html, text }
}
