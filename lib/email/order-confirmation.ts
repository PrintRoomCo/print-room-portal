import { sendEmail, type SendEmailResult } from '@/lib/email/client'
import { getSupabaseServer } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import {
  wrapBrandedEmail,
  escapeHtml,
  BRAND_FONT,
  BRAND_MONO,
  BRAND_ACCENT,
  INK,
  BODY,
  MUTED,
  LINE,
  SURFACE,
} from '@/lib/email/shared'

export interface OrderConfirmationParams {
  to: string
  customerName: string
  /** orders.id — used by the email log writer. */
  orderId: string
  orderRef: string
  /**
   * What the customer is INVOICED, ex-GST: billed goods + pickingFee. Prepaid
   * stock draws contribute 0. NOT the goods value — the staff dispatch email
   * carries that instead, labelled "Goods value".
   */
  totalAmount: number
  /** NZ picking fee, ex-GST. 0 when none applies. */
  pickingFee?: number
  /** Goods drawn from pre-paid stock and NOT invoiced. 0 for a normal order. */
  prepaidGoodsValue?: number
  requiredBy: string | null
  /** ISO timestamp of the ordering-period close — renders the provisional-pricing note. */
  provisionalUntil?: string | null
  lines: Array<{
    productName: string
    variantLabel: string
    quantity: number
    unitPrice: number
  }>
  /** Immutable ISO-4217 billing currency stamped on the quote. Default NZD. */
  currency?: string
}

function formatMoney(n: number, currency = 'NZD'): string {
  return formatCurrency(n, currency)
}

/** True when the variant label carries real content (not an empty/placeholder dash). */
function hasVariant(label: string): boolean {
  const v = label.trim()
  return v.length > 0 && v !== '-' && v !== '—'
}

/**
 * Build the order-confirmation email — subject, branded HTML, and plain-text
 * fallback — as a pure function (no network, no DB). Kept separate from
 * {@link sendOrderConfirmation} so the rendered output can be unit-tested and
 * previewed without sending anything.
 */
export function buildOrderConfirmationEmail(params: OrderConfirmationParams): {
  subject: string
  html: string
  text: string
} {
  const money = (n: number) => formatMoney(n, params.currency ?? 'NZD')
  const provisionalNote = params.provisionalUntil
    ? `Pricing is provisional until your ordering window closes on ${new Date(
        params.provisionalUntil,
      ).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}. ` +
      `Your final price can only stay the same or drop as your network's total volume grows.`
    : null

  // ── Line-item rows ──────────────────────────────────────────────────────
  const cellBase = `padding:14px 0;border-bottom:1px solid ${LINE};vertical-align:top;`
  const numCell = `${cellBase}text-align:right;font-family:${BRAND_MONO};font-size:14px;white-space:nowrap;padding-left:16px;`
  const lineRowsHtml = params.lines
    .map((line) => {
      const productName = escapeHtml(line.productName)
      const variantLabel = escapeHtml(line.variantLabel)
      const quantity = line.quantity.toString()
      const unitPrice = money(line.unitPrice)
      const lineTotal = money(line.unitPrice * line.quantity)

      return `<tr>
              <td style="${cellBase}">
                <span style="font-family:${BRAND_FONT};font-size:15px;font-weight:600;color:${INK};">${productName}</span>${
                  hasVariant(line.variantLabel)
                    ? `<br/><span style="font-family:${BRAND_FONT};font-size:12px;color:${MUTED};">${variantLabel}</span>`
                    : ''
                }
              </td>
              <td style="${numCell}color:${BODY};">${quantity}</td>
              <td style="${numCell}color:${BODY};">${unitPrice}</td>
              <td style="${numCell}color:${INK};">${lineTotal}</td>
            </tr>`
    })
    .join('')

  const headCell = `padding:0 0 10px;border-bottom:2px solid ${INK};font-family:${BRAND_FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};`
  const labelStyle = `font-family:${BRAND_FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};`

  // ── Body content (wrapped by the branded shell) ─────────────────────────
  const body = `
            <p style="margin:0 0 10px;font-family:${BRAND_FONT};font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">Order confirmation</p>
            <h1 class="b-h1" style="margin:0 0 18px;font-family:${BRAND_FONT};font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-0.02em;color:${INK};">Order received</h1>

            <p style="margin:0 0 4px;${labelStyle}">Your reference</p>
            <p style="margin:0 0 22px;font-family:${BRAND_MONO};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${BRAND_ACCENT};">${escapeHtml(params.orderRef)}</p>

            <p style="margin:0 0 26px;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">Hi ${escapeHtml(params.customerName)}, thanks for your order. We've received it and we're on it. We'll be in touch with the next steps shortly.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <thead>
                <tr>
                  <th align="left" style="${headCell}text-align:left;">Item</th>
                  <th align="right" style="${headCell}text-align:right;padding-left:16px;">Qty</th>
                  <th align="right" style="${headCell}text-align:right;padding-left:16px;">Unit</th>
                  <th align="right" style="${headCell}text-align:right;padding-left:16px;">Total</th>
                </tr>
              </thead>
              <tbody>${lineRowsHtml}
              </tbody>
              <tfoot>${
                (params.prepaidGoodsValue ?? 0) > 0
                  ? `
                <tr>
                  <td colspan="3" style="padding:14px 0 0;text-align:right;font-size:12px;color:#6b7280;">Drawn from pre-paid stock</td>
                  <td style="padding:14px 0 0 16px;text-align:right;font-family:${BRAND_MONO};font-size:12px;color:#6b7280;white-space:nowrap;">${money(params.prepaidGoodsValue ?? 0)}</td>
                </tr>`
                  : ''
              }${
                (params.pickingFee ?? 0) > 0
                  ? `
                <tr>
                  <td colspan="3" style="padding:6px 0 0;text-align:right;font-size:13px;color:#374151;">Picking fee</td>
                  <td style="padding:6px 0 0 16px;text-align:right;font-family:${BRAND_MONO};font-size:13px;color:#374151;white-space:nowrap;">${money(params.pickingFee ?? 0)}</td>
                </tr>`
                  : ''
              }
                <tr>
                  <td colspan="3" style="padding:18px 0 0;text-align:right;${labelStyle}">Total</td>
                  <td style="padding:18px 0 0 16px;text-align:right;font-family:${BRAND_MONO};font-size:18px;font-weight:700;color:${INK};white-space:nowrap;">${money(params.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
${
  provisionalNote
    ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
              <tr>
                <td style="padding:14px 18px;background-color:${SURFACE};border-left:4px solid ${BRAND_ACCENT};font-family:${BRAND_FONT};font-size:13px;line-height:1.6;color:${BODY};">${escapeHtml(provisionalNote)}</td>
              </tr>
            </table>`
    : ''
}
            <p style="margin:30px 0 0;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">Thanks,<br/><span style="color:${INK};font-weight:700;">The Print Room team</span></p>`

  const subject = `Order received - ${params.orderRef}`
  const html = wrapBrandedEmail(`Order received - ${escapeHtml(params.orderRef)}`, body, {
    preheader: `Order ${params.orderRef} received. We're on it.`,
  })

  // ── Plain-text fallback ─────────────────────────────────────────────────
  const textLines = params.lines
    .map(
      (line) =>
        `${line.productName}${hasVariant(line.variantLabel) ? ` (${line.variantLabel})` : ''} x ${line.quantity} @ ${money(line.unitPrice)} = ${money(line.unitPrice * line.quantity)}`
    )
    .join('\n')

  const text =
    `Order received - ${params.orderRef}\n\n` +
    `Hi ${params.customerName}, thanks for your order. We've received it and we're on it. We'll be in touch with the next steps shortly.\n\n` +
    `Your reference: ${params.orderRef}\n\n` +
    `${textLines}\n\n` +
    ((params.prepaidGoodsValue ?? 0) > 0
      ? `Drawn from pre-paid stock: ${money(params.prepaidGoodsValue ?? 0)}\n`
      : '') +
    ((params.pickingFee ?? 0) > 0
      ? `Picking fee: ${money(params.pickingFee ?? 0)}\n`
      : '') +
    `Total: ${money(params.totalAmount)}\n` +
    (provisionalNote ? `\n${provisionalNote}\n` : '') +
    `\nQuestions? Reply to this email or contact hello@theprint-room.co.nz.\n\n` +
    `Thanks,\nThe Print Room team`

  return { subject, html, text }
}

export async function sendOrderConfirmation(
  params: OrderConfirmationParams
): Promise<SendEmailResult> {
  const { subject, html, text } = buildOrderConfirmationEmail(params)

  let result: SendEmailResult
  try {
    result = await sendEmail({ to: params.to, subject, html, text })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    result = { success: false, error: message, messageId: null }
  }

  // Audit-log the send. Failure here must not bubble up.
  try {
    const admin = getSupabaseServer()
    await admin.from('order_email_log').insert({
      order_id: params.orderId,
      email_type: 'order_confirmation',
      recipient_email: params.to,
      resend_message_id: result.messageId ?? null,
      status: result.success ? 'sent' : 'failed',
      error_message: result.success ? null : result.error ?? null,
      payload_meta: { orderRef: params.orderRef },
    })
  } catch (logErr) {
    const message = logErr instanceof Error ? logErr.message : 'Unknown error'
    console.error('[Email] order_email_log write failed:', message)
  }

  return result
}
