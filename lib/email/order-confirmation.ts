import { sendEmail, type SendEmailResult } from '@/lib/email/client'
import { getSupabaseServer } from '@/lib/supabase'

export interface OrderConfirmationParams {
  to: string
  customerName: string
  /** orders.id — used by the email log writer. */
  orderId: string
  orderRef: string
  totalAmount: number
  paymentTerms: string | null
  /**
   * Plain-text contract notes from b2b_accounts.contract_notes. Surfaced under
   * the payment-terms line when pricingMode === 'contract'. Null otherwise.
   */
  contractNotes?: string | null
  pricingMode?: string | null
  requiredBy: string | null
  /** ISO timestamp of the ordering-period close — renders the provisional-pricing note. */
  provisionalUntil?: string | null
  lines: Array<{
    productName: string
    variantLabel: string
    quantity: number
    unitPrice: number
  }>
}

function formatPaymentTerms(terms: string | null | undefined): string {
  switch (terms) {
    case 'prepay':
      return 'Prepaid (100% upfront)'
    case 'net20':
      return 'Net 20 days'
    case 'net30':
      return 'Net 30 days'
    case 'contract':
      return 'Contract terms'
    default:
      return terms ?? 'as per agreement'
  }
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendOrderConfirmation(
  params: OrderConfirmationParams
): Promise<SendEmailResult> {
  const paymentTerms = formatPaymentTerms(params.paymentTerms)
  const contractNotes =
    params.pricingMode === 'contract' && params.contractNotes
      ? params.contractNotes
      : null
  const requiredBy = params.requiredBy ?? null
  const provisionalNote = params.provisionalUntil
    ? `Pricing is provisional until your ordering window closes on ${new Date(
        params.provisionalUntil,
      ).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}. ` +
      `Your final price can only stay the same or drop as your network's total volume grows.`
    : null
  const lineRowsHtml = params.lines
    .map((line) => {
      const productName = escapeHtml(line.productName)
      const variantLabel = escapeHtml(line.variantLabel)
      const quantity = line.quantity.toString()
      const unitPrice = formatMoney(line.unitPrice)
      const lineTotal = formatMoney(line.unitPrice * line.quantity)

      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${productName}<br/><span style="color:#6b7280;font-size:12px;">${variantLabel}</span></td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${unitPrice}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${lineTotal}</td>
      </tr>`
    })
    .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Order received - ${escapeHtml(params.orderRef)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f2ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
  <div style="width:100%;background-color:#f5f2ed;padding:24px 0;">
    <div style="max-width:640px;margin:0 auto;padding:0 16px;">
      <div style="background-color:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
          <strong style="font-size:16px;color:#111827;">THE PRINT ROOM</strong>
        </div>
        <div style="padding:24px;">
          <h1 style="margin:0 0 8px;font-size:24px;line-height:1.3;color:#111827;">Order received</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">Hi ${escapeHtml(params.customerName)}, thanks - we have received your order ${escapeHtml(params.orderRef)} and will be in touch with next steps.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="color:#6b7280;">
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:left;">Item</th>
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:right;">Qty</th>
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:right;">Unit</th>
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:right;">Line</th>
              </tr>
            </thead>
            <tbody>${lineRowsHtml}</tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="padding:10px 8px;text-align:right;font-weight:700;">Total</td>
                <td style="padding:10px 8px;text-align:right;font-weight:700;">${formatMoney(params.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
          ${provisionalNote ? `<p style="margin:18px 0 0;padding:14px 16px;border-radius:10px;background-color:#fefce8;border:1px solid #fde68a;font-size:13px;color:#92400e;">${escapeHtml(provisionalNote)}</p>` : ''}
          <div style="margin:18px 0 0;padding:14px 16px;border-radius:10px;background-color:#f3f4f6;font-size:13px;color:#374151;">
            <div>Payment terms: <strong>${escapeHtml(paymentTerms)}</strong></div>
            ${contractNotes ? `<div style="margin-top:6px;color:#4b5563;">${escapeHtml(contractNotes)}</div>` : ''}
            ${requiredBy ? `<div style="margin-top:6px;">Required by: <strong>${escapeHtml(requiredBy)}</strong></div>` : ''}
          </div>
          <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#4b5563;">Questions? Reply to this email or contact hello@theprint-room.co.nz.</p>
          <p style="margin:16px 0 0;font-size:13px;color:#111827;">Thanks,<br/><strong>The Print Room Team</strong></p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`

  const textLines = params.lines
    .map(
      (line) =>
        `${line.productName} ${line.variantLabel} x ${line.quantity} @ ${formatMoney(line.unitPrice)} = ${formatMoney(line.unitPrice * line.quantity)}`
    )
    .join('\n')

  const text =
    `Order received - ${params.orderRef}\n\n` +
    `Hi ${params.customerName}, thanks - we have received your order.\n\n` +
    `${textLines}\n\n` +
    `Total: ${formatMoney(params.totalAmount)}\n` +
    `Payment terms: ${paymentTerms}\n` +
    (contractNotes ? `${contractNotes}\n` : '') +
    (requiredBy ? `Required by: ${requiredBy}\n` : '') +
    (provisionalNote ? `\n${provisionalNote}\n` : '') +
    `\nQuestions? Reply to this email or contact hello@theprint-room.co.nz.\n\n` +
    `Thanks,\nThe Print Room Team`

  let result: SendEmailResult
  try {
    result = await sendEmail({
      to: params.to,
      subject: `Order received - ${params.orderRef}`,
      html,
      text,
    })
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
