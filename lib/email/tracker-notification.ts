/**
 * Tracker Status Email Notifications
 *
 * Branded HTML email in the Print Room "Peaceful Engineering" look — the same
 * shell (wrapBrandedEmail) and design tokens as the order-confirmation email,
 * so every customer-portal email reads as one family: a white field, a single
 * electric-blue accent, grotesque headings and a monospace reference.
 */

import { sendEmail } from './client'
import { getStatusLabel } from '@/lib/job-tracker'
import {
  wrapBrandedEmail,
  escapeHtml,
  BRAND_FONT,
  BRAND_MONO,
  BRAND_ACCENT,
  INK,
  BODY,
  MUTED,
  SURFACE,
} from '@/lib/email/shared'

// Portal-native tracker base. The status email's "View order tracker" CTA links
// into the authed customer portal (/order-tracker/<token>), not the retired
// external Shopify-proxy page. Override origin via NEXT_PUBLIC_SITE_URL.
const PORTAL_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'

/** Shared small-caps label style (matches order-confirmation.ts). */
const LABEL_STYLE = `font-family:${BRAND_FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};`

interface TrackerEmailParams {
  contactEmail: string
  trackerToken: string
  jobReference: string
  quoteNumber?: string
  newStatus: string
  trackingNumber?: string
  trackingUrl?: string
  carrier?: string
}

/**
 * Send a status update email for a job tracker.
 */
export async function sendTrackerStatusEmail(
  params: TrackerEmailParams
): Promise<{ success: boolean; error?: string }> {
  const trackerUrl = `${PORTAL_ORIGIN}/order-tracker/${params.trackerToken}`
  const statusLabel = getStatusLabel(params.newStatus)
  const ref = params.quoteNumber || params.jobReference
  const subject = `Order update: ${statusLabel} — ${ref}`

  const safeUrl = escapeHtml(trackerUrl)
  const safeRef = escapeHtml(ref)
  const safeStatus = escapeHtml(statusLabel)

  // Job reference sub-line, shown when the quote number is the headline reference.
  const subLine =
    params.quoteNumber && params.jobReference && params.quoteNumber !== params.jobReference
      ? `<p style="margin:0 0 24px;font-family:${BRAND_FONT};font-size:13px;line-height:1.5;color:${BODY};">Job reference: <strong style="color:${INK};">${escapeHtml(params.jobReference)}</strong></p>`
      : ''

  const trackingPanel =
    params.trackingNumber || params.trackingUrl
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;background-color:${SURFACE};border-radius:12px;">
              <tr>
                <td style="padding:18px 20px;font-family:${BRAND_FONT};font-size:14px;line-height:1.7;color:${BODY};">
                  <div style="${LABEL_STYLE}margin:0 0 8px;">Tracking</div>
                  ${params.trackingNumber ? `<div>Tracking number: <strong style="color:${INK};">${escapeHtml(params.trackingNumber)}</strong></div>` : ''}
                  ${params.carrier ? `<div>Carrier: <strong style="color:${INK};">${escapeHtml(params.carrier)}</strong></div>` : ''}
                  ${params.trackingUrl ? `<div style="margin-top:4px;"><a href="${escapeHtml(params.trackingUrl)}" class="b-link" style="color:${BRAND_ACCENT};text-decoration:underline;">Track with carrier &rarr;</a></div>` : ''}
                </td>
              </tr>
            </table>`
      : ''

  const body = `
            <h1 class="b-h1" style="margin:0 0 18px;font-family:${BRAND_FONT};font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-0.02em;color:${INK};">Your order status has changed</h1>

            <p style="margin:0 0 4px;${LABEL_STYLE}text-transform:none;">Your Reference</p>
            <p style="margin:0 0 ${subLine ? 6 : 24}px;font-family:${BRAND_MONO};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${BRAND_ACCENT};">${safeRef}</p>${subLine}

            <p style="margin:0 0 26px;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">Kia ora — your order is now <strong style="color:${INK};font-weight:700;">${safeStatus}</strong>. Follow the tracker any time to see the latest.</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 14px;">
              <tr>
                <td align="center" style="border-radius:9999px;background-color:${BRAND_ACCENT};">
                  <a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:${BRAND_ACCENT};color:#ffffff;border-radius:9999px;padding:15px 34px;font-family:${BRAND_FONT};font-size:15px;font-weight:700;letter-spacing:0.01em;text-decoration:none;">View order tracker</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px;font-family:${BRAND_FONT};font-size:12px;line-height:1.6;color:${MUTED};">If the button doesn&rsquo;t work, copy and paste this link into your browser:</p>
            <p style="margin:0 0 8px;font-family:${BRAND_MONO};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" class="b-link" style="color:${BRAND_ACCENT};text-decoration:underline;">${safeUrl}</a></p>
            ${trackingPanel}
            <p style="margin:22px 0 0;font-family:${BRAND_FONT};font-size:14px;line-height:1.65;color:${BODY};">Questions? Please contact your account manager.</p>

            <p style="margin:30px 0 0;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">Thanks,<br/><span style="color:${INK};font-weight:700;">The Print Room team</span></p>`

  const html = wrapBrandedEmail(subject, body, {
    preheader: `Your order is now ${statusLabel}.`,
  })

  const text = `Order update: ${statusLabel} — ${ref}

Kia ora,

Your order is now ${statusLabel}. Follow the tracker any time to see the latest.

Your reference: ${ref}
${params.quoteNumber && params.jobReference && params.quoteNumber !== params.jobReference ? `Job reference: ${params.jobReference}\n` : ''}${params.trackingNumber ? `Tracking number: ${params.trackingNumber}\n` : ''}${params.carrier ? `Carrier: ${params.carrier}\n` : ''}
View order tracker: ${trackerUrl}

Questions? Please contact your account manager.

Thanks,
The Print Room team`

  return sendEmail({ to: params.contactEmail, subject, html, text })
}
