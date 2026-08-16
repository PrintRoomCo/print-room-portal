/**
 * Item 13 — internal order-placed dispatch email. Sent to the dispatch desk
 * (or the test inbox for demo orgs) the moment an order posts, reusing the same
 * branded shell as the customer order-confirmation so staff mail reads on-brand.
 * Pure build + thin send; best-effort is handled at the call site (submit.ts).
 */
import { sendEmail, type SendEmailResult } from '@/lib/email/client'
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

export interface OrderPlacedDispatchParams {
  to: string
  orderRef: string
  /** Ordering org / customer display name. */
  customerName: string
  orderType: 'stock_on_hand' | 'purchase_order'
  /**
   * The GOODS value, NOT the invoice — rendered as "Goods value".
   *
   * Staff care what is leaving the building. A prepaid order's invoice is just
   * the picking fee, so a dispatch note reading "$17.25" against 120 tees would
   * be actively misleading. The customer-facing billed figure lives on the
   * order-confirmation email instead.
   */
  totalAmount: number
  /** Absolute portal deep link to the order. */
  orderUrl: string
  /** Person who placed the order (B2BCustomerContext.fullName). Optional — omitted when unknown. */
  ordererName?: string | null
  /** Email of the person who placed the order. Optional — pairs with ordererName. */
  ordererEmail?: string | null
  /**
   * Formatted multi-line delivery address (formatShippingAddress output, '\n'
   * separated). Null for stock-into-inventory orders with no ship-to — the row
   * is then omitted rather than rendered blank.
   */
  deliveryAddress?: string | null
  lines: Array<{
    productName: string
    variantLabel: string
    quantity: number
    unitPrice: number
  }>
  /** Billing currency. AUD renders every money figure with an A$ prefix so staff
   *  and customers can never misread an AUD figure as NZD. Default NZD. */
  currency?: 'NZD' | 'AUD'
}

const ORDER_TYPE_LABEL: Record<OrderPlacedDispatchParams['orderType'], string> = {
  stock_on_hand: 'Stock on hand',
  purchase_order: 'Purchase order',
}

function formatMoney(n: number, currency: 'NZD' | 'AUD' = 'NZD'): string {
  return `${currency === 'AUD' ? 'A$' : '$'}${n.toFixed(2)}`
}

function hasVariant(label: string): boolean {
  const v = label.trim()
  return v.length > 0 && v !== '-' && v !== '—'
}

/** "Name (email)" / "Name" / "email" / null — never a bare "()" or "undefined". */
function formatOrderer(name?: string | null, email?: string | null): string | null {
  const n = name?.trim()
  const e = email?.trim()
  if (n && e) return `${n} (${e})`
  return n || e || null
}

export function buildOrderPlacedDispatchEmail(params: OrderPlacedDispatchParams): {
  subject: string
  html: string
  text: string
} {
  const money = (n: number) => formatMoney(n, params.currency ?? 'NZD')
  const typeLabel = ORDER_TYPE_LABEL[params.orderType]
  const orderer = formatOrderer(params.ordererName, params.ordererEmail)
  const deliveryAddress = params.deliveryAddress?.trim() || null
  const labelStyle = `font-family:${BRAND_FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};`
  const headCell = `padding:0 0 10px;border-bottom:2px solid ${INK};${labelStyle}`
  const cellBase = `padding:12px 0;border-bottom:1px solid ${LINE};vertical-align:top;`
  const numCell = `${cellBase}text-align:right;font-family:${BRAND_MONO};font-size:14px;white-space:nowrap;padding-left:16px;`

  const rowsHtml = params.lines
    .map((line) => {
      const name = escapeHtml(line.productName)
      const variant = escapeHtml(line.variantLabel)
      return `<tr>
              <td style="${cellBase}"><span style="font-family:${BRAND_FONT};font-size:15px;font-weight:600;color:${INK};">${name}</span>${
                hasVariant(line.variantLabel)
                  ? `<br/><span style="font-family:${BRAND_FONT};font-size:12px;color:${MUTED};">${variant}</span>`
                  : ''
              }</td>
              <td style="${numCell}color:${BODY};">${line.quantity}</td>
              <td style="${numCell}color:${INK};">${money(line.unitPrice * line.quantity)}</td>
            </tr>`
    })
    .join('')

  const body = `
            <p style="margin:0 0 10px;${labelStyle}">New order</p>
            <h1 class="b-h1" style="margin:0 0 18px;font-family:${BRAND_FONT};font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-0.02em;color:${INK};">Order placed</h1>

            <p style="margin:0 0 4px;${labelStyle}">Reference</p>
            <p style="margin:0 0 18px;font-family:${BRAND_MONO};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${BRAND_ACCENT};">${escapeHtml(params.orderRef)}</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background-color:${SURFACE};border-radius:12px;">
              <tr><td style="padding:16px 18px;font-family:${BRAND_FONT};font-size:14px;line-height:1.7;color:${BODY};">
                <div>Customer: <strong style="color:${INK};">${escapeHtml(params.customerName)}</strong></div>${
                  orderer
                    ? `\n                <div>Ordered by: <strong style="color:${INK};">${escapeHtml(orderer)}</strong></div>`
                    : ''
                }
                <div>Order type: <strong style="color:${INK};">${escapeHtml(typeLabel)}</strong></div>${
                  deliveryAddress
                    ? `\n                <div style="margin-top:8px;">Deliver to:<br/><strong style="color:${INK};">${escapeHtml(deliveryAddress).replace(/\n/g, '<br/>')}</strong></div>`
                    : ''
                }
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <thead><tr>
                <th align="left" style="${headCell}text-align:left;">Item</th>
                <th align="right" style="${headCell}text-align:right;padding-left:16px;">Qty</th>
                <th align="right" style="${headCell}text-align:right;padding-left:16px;">Total</th>
              </tr></thead>
              <tbody>${rowsHtml}
              </tbody>
              <tfoot><tr>
                <td colspan="2" style="padding:16px 0 0;text-align:right;${labelStyle}">Goods value</td>
                <td style="padding:16px 0 0 16px;text-align:right;font-family:${BRAND_MONO};font-size:18px;font-weight:700;color:${INK};white-space:nowrap;">${money(params.totalAmount)}</td>
              </tr></tfoot>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
              <tr><td align="center" style="border-radius:9999px;background-color:${BRAND_ACCENT};">
                <a href="${escapeHtml(params.orderUrl)}" target="_blank" style="display:inline-block;background-color:${BRAND_ACCENT};color:#ffffff;border-radius:9999px;padding:15px 34px;font-family:${BRAND_FONT};font-size:15px;font-weight:700;text-decoration:none;">Open order</a>
              </td></tr>
            </table>`

  const subject = `Order placed — ${params.orderRef} (${typeLabel})`
  const html = wrapBrandedEmail(subject, body, {
    preheader: `${params.customerName} — ${money(params.totalAmount)}`,
  })

  const textLines = params.lines
    .map(
      (l) =>
        `${l.productName}${hasVariant(l.variantLabel) ? ` (${l.variantLabel})` : ''} x ${l.quantity} = ${money(l.unitPrice * l.quantity)}`,
    )
    .join('\n')
  const text =
    `Order placed — ${params.orderRef} (${typeLabel})\n\n` +
    `Customer: ${params.customerName}\n` +
    (orderer ? `Ordered by: ${orderer}\n` : '') +
    `Order type: ${typeLabel}\n` +
    (deliveryAddress ? `\nDeliver to:\n${deliveryAddress}\n` : '') +
    `\n${textLines}\n\n` +
    `Goods value: ${money(params.totalAmount)}\n\n` +
    `Open order: ${params.orderUrl}\n`

  return { subject, html, text }
}

export async function sendOrderPlacedDispatch(
  params: OrderPlacedDispatchParams,
): Promise<SendEmailResult> {
  const { subject, html, text } = buildOrderPlacedDispatchEmail(params)
  return sendEmail({ to: params.to, subject, html, text })
}
