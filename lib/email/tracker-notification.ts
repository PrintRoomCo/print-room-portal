/**
 * Tracker Status Email Notifications
 *
 * Branded HTML email templates matching the Print Room design.
 */

import { sendEmail } from './client'
import { getStatusLabel } from '@/lib/job-tracker'

const TRACKER_BASE_URL =
  process.env.PUBLIC_TRACKER_BASE_URL || 'https://www.theprintroom.nz/apps/order-tracker'

// Shared email styles
const EMAIL_STYLES = `
  body { margin:0; padding:0; background-color:#f5f2ed; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:#1f2933; }
  .wrapper { width:100%; background-color:#f5f2ed; padding:24px 0; }
  .container { max-width:640px; margin:0 auto; padding:0 16px; }
  .card { background-color:#f8faf4; border-radius:16px; border:2px solid #111827; box-shadow:0 12px 24px rgba(15,23,42,0.16); overflow:hidden; }
  .card-header { padding:20px 24px; border-bottom:1px solid #e5e7eb; background-color:#f8faf4; }
  .badge { display:inline-flex; align-items:center; padding:6px 12px; border-radius:999px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:#fff; }
  .card-body { padding:24px 24px 20px; }
  h1 { margin:0 0 8px; font-size:24px; line-height:1.3; color:#111827; }
  p { margin:0 0 12px; font-size:14px; line-height:1.6; color:#374151; }
  .details { margin:18px 0 20px; padding:14px 16px; border-radius:12px; background-color:#ede8dd; font-size:13px; color:#111827; }
  .details-label { font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:0.08em; color:#6b7280; margin-bottom:4px; }
  .details-row { margin:2px 0; }
  .button-row { text-align:center; margin:24px 0 18px; }
  .button { display:inline-block; padding:12px 28px; border-radius:999px; background-color:#2b3990; color:#f9fafb !important; font-size:14px; font-weight:600; text-decoration:none; letter-spacing:0.04em; text-transform:uppercase; }
  .link-row { font-size:12px; color:#6b7280; word-break:break-all; }
  .link-row a { color:#1d4ed8; text-decoration:underline; }
  .footer { margin-top:16px; text-align:center; font-size:11px; color:#6b7280; }
`

const STATUS_COLORS: Record<string, string> = {
  'in-production': '#F59E0B',
  'proof-sent': '#3B82F6',
  'proof-approved': '#10B981',
  'dispatched': '#2563EB',
  'delivered': '#10B981',
  'quote-accepted-mockup': '#8B5CF6',
  'need-proof': '#F59E0B',
}

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
  const trackerUrl = `${TRACKER_BASE_URL}/job/${params.trackerToken}`
  const statusLabel = getStatusLabel(params.newStatus)
  const ref = params.quoteNumber || params.jobReference
  const subject = `Order update: ${statusLabel} — ${ref}`
  const badgeColor = STATUS_COLORS[params.newStatus] || '#6B7280'

  const trackingSection =
    params.trackingNumber || params.trackingUrl
      ? `<div style="margin:18px 0 0;padding:14px 16px;border-radius:12px;background-color:#EFF6FF;font-size:13px;color:#111827;">
          <div style="font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.08em;color:#3B82F6;margin-bottom:6px;">Tracking Information</div>
          ${params.trackingNumber ? `<div style="margin:2px 0;">Tracking: <strong>${params.trackingNumber}</strong></div>` : ''}
          ${params.carrier ? `<div style="margin:2px 0;">Carrier: <strong>${params.carrier}</strong></div>` : ''}
          ${params.trackingUrl ? `<div style="margin:6px 0 0;"><a href="${params.trackingUrl}" style="color:#2563EB;text-decoration:underline;">Track with carrier</a></div>` : ''}
        </div>`
      : ''

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${subject}</title><style>${EMAIL_STYLES}</style></head>
<body><div class="wrapper"><div class="container">
  <div class="card">
    <div class="card-header"><div style="display:flex;align-items:center;justify-content:space-between;">
      <div><strong style="font-size:16px;color:#111827;">THE PRINT ROOM</strong></div>
      <span class="badge" style="background-color:${badgeColor};">${statusLabel}</span>
    </div></div>
    <div class="card-body">
      <h1>Order status update</h1>
      <p>Kia ora,</p>
      <p>Your order status has been updated to <strong>${statusLabel}</strong>.</p>
      <div class="details">
        <div class="details-label">Order details</div>
        ${params.quoteNumber ? `<div class="details-row">Quote: <strong>${params.quoteNumber}</strong></div>` : ''}
        <div class="details-row">Job reference: <strong>${params.jobReference}</strong></div>
      </div>
      ${trackingSection}
      <div class="button-row"><a href="${trackerUrl}" class="button">View order tracker</a></div>
      <div class="link-row">If the button doesn't work, copy and paste this link:<br/><a href="${trackerUrl}">${trackerUrl}</a></div>
      <p style="margin-top:18px;font-size:13px;color:#4b5563;">Questions? Please contact your account manager.</p>
      <p style="margin-top:16px;font-size:13px;color:#111827;">Thanks,<br/><strong>The Print Room Team</strong></p>
    </div>
  </div>
  <div class="footer">This is an automated message from The Print Room. Please do not reply directly.</div>
</div></div></body></html>`

  const text = `Order update: ${statusLabel} — ${ref}

Kia ora,

Your order status has been updated to ${statusLabel}.

${params.quoteNumber ? `Quote: ${params.quoteNumber}` : ''}
Job reference: ${params.jobReference}
${params.trackingNumber ? `Tracking: ${params.trackingNumber}` : ''}
${params.carrier ? `Carrier: ${params.carrier}` : ''}

View order tracker: ${trackerUrl}

Questions? Please contact your account manager.

Thanks,
The Print Room Team`

  return sendEmail({ to: params.contactEmail, subject, html, text })
}
