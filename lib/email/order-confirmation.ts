import { sendEmail, type SendEmailResult } from '@/lib/email/client'
import { getSupabaseServer } from '@/lib/supabase'

export interface OrderConfirmationLine {
  productName: string
  variantLabel: string
  quantity: number
  unitPrice: number
}

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
   * the payment-terms line when paymentTerms === 'contract'. Null otherwise.
   */
  contractNotes?: string | null
  requiredBy: string | null
  lines: OrderConfirmationLine[]
}

/**
 * One section in the split-order email body. Each section represents a child
 * order in a cart_submission_id group (customer-ship or inventory-shelf).
 */
export interface SplitOrderSection {
  /** Heading shown above the table — e.g. "Customer ship". */
  label: string
  /** Child order ref — e.g. "PRT-12345-C". */
  orderRef: string
  /** orders.id — used by the email log writer to row this section against. */
  orderId: string
  lines: OrderConfirmationLine[]
  /** Subtotal for this section's lines. */
  subtotal: number
}

export interface SplitOrderConfirmationParams {
  to: string
  customerName: string
  /** cart_submissions.id — links the two child orders together. */
  cartSubmissionId: string
  /**
   * Base ref shared by both children, with the `-C`/`-I` suffix stripped.
   * Surfaces in the subject as "{baseRef} (2 parts)".
   */
  baseRef: string
  customerSection: SplitOrderSection
  inventorySection: SplitOrderSection
  paymentTerms: string | null
  contractNotes?: string | null
  requiredBy: string | null
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

function renderLineRows(lines: OrderConfirmationLine[]): string {
  return lines
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
}

function renderLinesTable(lines: OrderConfirmationLine[], footer: string): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="color:#6b7280;">
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:left;">Item</th>
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:right;">Qty</th>
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:right;">Unit</th>
                <th style="padding:8px;border-bottom:1px solid #d1d5db;text-align:right;">Line</th>
              </tr>
            </thead>
            <tbody>${renderLineRows(lines)}</tbody>
            <tfoot>${footer}</tfoot>
          </table>`
}

function renderSplitSection(section: SplitOrderSection): string {
  const heading = escapeHtml(`${section.label} - ${section.orderRef}`)
  const subtotalFooter = `<tr>
                <td colspan="3" style="padding:10px 8px;text-align:right;font-weight:700;">Subtotal</td>
                <td style="padding:10px 8px;text-align:right;font-weight:700;">${formatMoney(section.subtotal)}</td>
              </tr>`
  return `<section style="margin:0 0 24px;">
          <h2 style="margin:0 0 8px;font-size:18px;line-height:1.3;color:#111827;">${heading}</h2>
          ${renderLinesTable(section.lines, subtotalFooter)}
        </section>`
}

function renderSplitSectionText(section: SplitOrderSection): string {
  const rows = section.lines
    .map(
      (line) =>
        `  ${line.productName} ${line.variantLabel} x ${line.quantity} @ ${formatMoney(line.unitPrice)} = ${formatMoney(line.unitPrice * line.quantity)}`,
    )
    .join('\n')
  return `${section.label} - ${section.orderRef}\n${rows}\n  Subtotal: ${formatMoney(section.subtotal)}`
}

async function logEmailSend(args: {
  orderId: string
  to: string
  result: SendEmailResult
  payloadMeta: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = getSupabaseServer()
    await admin.from('order_email_log').insert({
      order_id: args.orderId,
      email_type: 'order_confirmation',
      recipient_email: args.to,
      resend_message_id: args.result.messageId ?? null,
      status: args.result.success ? 'sent' : 'failed',
      error_message: args.result.success ? null : args.result.error ?? null,
      payload_meta: args.payloadMeta,
    })
  } catch (logErr) {
    const message = logErr instanceof Error ? logErr.message : 'Unknown error'
    console.error('[Email] order_email_log write failed:', message)
  }
}

export async function sendOrderConfirmation(
  params: OrderConfirmationParams
): Promise<SendEmailResult> {
  const paymentTerms = formatPaymentTerms(params.paymentTerms)
  const contractNotes =
    params.paymentTerms === 'contract' && params.contractNotes
      ? params.contractNotes
      : null
  const requiredBy = params.requiredBy ?? null
  const totalFooter = `<tr>
                <td colspan="3" style="padding:10px 8px;text-align:right;font-weight:700;">Total</td>
                <td style="padding:10px 8px;text-align:right;font-weight:700;">${formatMoney(params.totalAmount)}</td>
              </tr>`

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
          ${renderLinesTable(params.lines, totalFooter)}
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
  await logEmailSend({
    orderId: params.orderId,
    to: params.to,
    result,
    payloadMeta: { orderRef: params.orderRef },
  })

  return result
}

/**
 * Split-order confirmation: ONE email summarising both child orders from a
 * cart_submissions group. Subject reads "Order confirmation - {baseRef} (2 parts)",
 * body renders two <section> blocks (customer + inventory) with their own line
 * tables and subtotals, footer shows grand total = customer + inventory subtotals.
 *
 * Audit-logs against BOTH child orders so order_email_log keeps its
 * one-row-per-order shape (matches the existing single-path log writer).
 */
export async function sendOrderConfirmationSplit(
  params: SplitOrderConfirmationParams,
): Promise<SendEmailResult> {
  const paymentTerms = formatPaymentTerms(params.paymentTerms)
  const contractNotes =
    params.paymentTerms === 'contract' && params.contractNotes
      ? params.contractNotes
      : null
  const requiredBy = params.requiredBy ?? null
  const grandTotal = params.customerSection.subtotal + params.inventorySection.subtotal
  const subject = `Order confirmation - ${params.baseRef} (2 parts)`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${escapeHtml(subject)}</title>
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
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">Hi ${escapeHtml(params.customerName)}, thanks - we have received your order ${escapeHtml(params.baseRef)}. Because some items ship to you and others draw from your inventory, we have split it into two linked orders below.</p>
          ${renderSplitSection(params.customerSection)}
          ${renderSplitSection(params.inventorySection)}
          <div style="margin:0 0 18px;padding:12px 16px;border-radius:10px;background-color:#111827;color:#fff;display:flex;justify-content:space-between;font-size:15px;">
            <span style="font-weight:600;">Grand total</span>
            <span style="font-weight:700;">${formatMoney(grandTotal)}</span>
          </div>
          <div style="margin:0;padding:14px 16px;border-radius:10px;background-color:#f3f4f6;font-size:13px;color:#374151;">
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

  const text =
    `${subject}\n\n` +
    `Hi ${params.customerName}, thanks - we have received your order ${params.baseRef}.\n` +
    `It was split into two linked orders:\n\n` +
    `${renderSplitSectionText(params.customerSection)}\n\n` +
    `${renderSplitSectionText(params.inventorySection)}\n\n` +
    `Grand total: ${formatMoney(grandTotal)}\n` +
    `Payment terms: ${paymentTerms}\n` +
    (contractNotes ? `${contractNotes}\n` : '') +
    (requiredBy ? `Required by: ${requiredBy}\n` : '') +
    `\nQuestions? Reply to this email or contact hello@theprint-room.co.nz.\n\n` +
    `Thanks,\nThe Print Room Team`

  let result: SendEmailResult
  try {
    result = await sendEmail({
      to: params.to,
      subject,
      html,
      text,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    result = { success: false, error: message, messageId: null }
  }

  // Audit-log against BOTH child orders. Single send, two log rows — finance
  // can group via cart_submission_id in payload_meta.
  const payloadMeta = {
    cartSubmissionId: params.cartSubmissionId,
    baseRef: params.baseRef,
    customerOrderRef: params.customerSection.orderRef,
    inventoryOrderRef: params.inventorySection.orderRef,
    parts: 2,
  }
  await logEmailSend({
    orderId: params.customerSection.orderId,
    to: params.to,
    result,
    payloadMeta: { ...payloadMeta, bucket: 'customer' },
  })
  await logEmailSend({
    orderId: params.inventorySection.orderId,
    to: params.to,
    result,
    payloadMeta: { ...payloadMeta, bucket: 'inventory' },
  })

  return result
}
