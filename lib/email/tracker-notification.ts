/**
 * Tracker Status Email Notifications
 *
 * Branded HTML email in the Print Room "Peaceful Engineering" look — the same
 * shell (wrapBrandedEmail) and design tokens as the order-confirmation email,
 * so every customer-portal email reads as one family: a white field, a single
 * electric-blue accent, grotesque headings and a monospace reference.
 *
 * Two milestone variants, selected by `newStatus`:
 *   - `in-production` — "Your order is in production", no tracking block.
 *   - `dispatched`    — "Your order has shipped", with a tracking block when a
 *                       tracking number/URL is supplied, or a "tracking to
 *                       follow" note when it is not.
 * Any other status falls back to the generic "status has changed" copy.
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

interface MilestoneCopy {
  subject: string
  heading: string
  intro: string
  preheader: string
}

/**
 * Subject / heading / intro / preheader keyed on the milestone. `safeRef` is
 * already HTML-escaped for interpolation into `intro`; `subject` and `preheader`
 * are plain text.
 */
function milestoneCopy(newStatus: string, ref: string, safeRef: string): MilestoneCopy {
  if (newStatus === 'in-production') {
    return {
      subject: `Your order is in production — ${ref}`,
      heading: 'Your order is in production',
      intro: `Good news — your order <strong style="color:${INK};font-weight:700;">${safeRef}</strong> is now in production. We&rsquo;ll let you know the moment it ships.`,
      preheader: 'Your order is in production.',
    }
  }
  if (newStatus === 'dispatched') {
    return {
      subject: `Your order has shipped — ${ref}`,
      heading: 'Your order has shipped',
      intro: `Great news — your order <strong style="color:${INK};font-weight:700;">${safeRef}</strong> is on its way.`,
      preheader: 'Your order has shipped.',
    }
  }
  const statusLabel = getStatusLabel(newStatus)
  return {
    subject: `Order update: ${statusLabel} — ${ref}`,
    heading: 'Your order status has changed',
    intro: `Kia ora — your order is now <strong style="color:${INK};font-weight:700;">${escapeHtml(statusLabel)}</strong>. Follow the tracker any time to see the latest.`,
    preheader: `Your order is now ${statusLabel}.`,
  }
}

/**
 * Send a milestone status email for a job tracker.
 */
export async function sendTrackerStatusEmail(
  params: TrackerEmailParams
): Promise<{ success: boolean; error?: string }> {
  const trackerUrl = `${PORTAL_ORIGIN}/order-tracker/${params.trackerToken}`
  const ref = params.quoteNumber || params.jobReference

  const safeUrl = escapeHtml(trackerUrl)
  const safeRef = escapeHtml(ref)

  const copy = milestoneCopy(params.newStatus, ref, safeRef)
  const subject = copy.subject

  // Job reference sub-line, shown when the quote number is the headline reference.
  const subLine =
    params.quoteNumber && params.jobReference && params.quoteNumber !== params.jobReference
      ? `<p style="margin:0 0 24px;font-family:${BRAND_FONT};font-size:13px;line-height:1.5;color:${BODY};">Job reference: <strong style="color:${INK};">${escapeHtml(params.jobReference)}</strong></p>`
      : ''

  const hasTracking = Boolean(params.trackingNumber || params.trackingUrl)

  const trackingPanel = hasTracking
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

  // Dispatched but no tracking resolved yet → tell the customer it will follow.
  const trackingFollowNote =
    params.newStatus === 'dispatched' && !hasTracking
      ? `<p style="margin:22px 0 0;font-family:${BRAND_FONT};font-size:14px;line-height:1.65;color:${BODY};">Your tracking details will follow shortly — we&rsquo;ll send them through as soon as they&rsquo;re available.</p>`
      : ''

  const body = `
            <h1 class="b-h1" style="margin:0 0 18px;font-family:${BRAND_FONT};font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-0.02em;color:${INK};">${copy.heading}</h1>

            <p style="margin:0 0 4px;${LABEL_STYLE}text-transform:none;">Your Reference</p>
            <p style="margin:0 0 ${subLine ? 6 : 24}px;font-family:${BRAND_MONO};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${BRAND_ACCENT};">${safeRef}</p>${subLine}

            <p style="margin:0 0 26px;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">${copy.intro}</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 14px;">
              <tr>
                <td align="center" style="border-radius:9999px;background-color:${BRAND_ACCENT};">
                  <a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:${BRAND_ACCENT};color:#ffffff;border-radius:9999px;padding:15px 34px;font-family:${BRAND_FONT};font-size:15px;font-weight:700;letter-spacing:0.01em;text-decoration:none;">View order tracker</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px;font-family:${BRAND_FONT};font-size:12px;line-height:1.6;color:${MUTED};">If the button doesn&rsquo;t work, copy and paste this link into your browser:</p>
            <p style="margin:0 0 8px;font-family:${BRAND_MONO};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" class="b-link" style="color:${BRAND_ACCENT};text-decoration:underline;">${safeUrl}</a></p>
            ${trackingPanel}${trackingFollowNote}
            <p style="margin:22px 0 0;font-family:${BRAND_FONT};font-size:14px;line-height:1.65;color:${BODY};">Questions? Please contact your account manager.</p>

            <p style="margin:30px 0 0;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">Thanks,<br/><span style="color:${INK};font-weight:700;">The Print Room team</span></p>`

  const html = wrapBrandedEmail(subject, body, {
    preheader: copy.preheader,
  })

  const introText =
    params.newStatus === 'in-production'
      ? `Your order ${ref} is now in production. We'll let you know the moment it ships.`
      : params.newStatus === 'dispatched'
        ? `Your order ${ref} is on its way.`
        : `Your order is now ${getStatusLabel(params.newStatus)}. Follow the tracker any time to see the latest.`

  const text = `${subject}

Kia ora,

${introText}

Your reference: ${ref}
${params.quoteNumber && params.jobReference && params.quoteNumber !== params.jobReference ? `Job reference: ${params.jobReference}\n` : ''}${params.trackingNumber ? `Tracking number: ${params.trackingNumber}\n` : ''}${params.carrier ? `Carrier: ${params.carrier}\n` : ''}${params.trackingUrl ? `Tracking: ${params.trackingUrl}\n` : ''}${params.newStatus === 'dispatched' && !hasTracking ? `Tracking details will follow shortly.\n` : ''}
View order tracker: ${trackerUrl}

Questions? Please contact your account manager.

Thanks,
The Print Room team`

  return sendEmail({ to: params.contactEmail, subject, html, text })
}
