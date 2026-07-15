/**
 * Item 13 — order-placed Slack notification.
 *
 * Posts a Block Kit message to the ops channel via the incoming webhook in
 * SLACK_PORTAL_WEBHOOK_URL. Ships BEFORE that channel/webhook exists, so a
 * missing env var is a clean no-op (never throws, never logs an error) — the
 * order must not care whether Slack is wired up yet.
 */

export interface OrderPlacedSummaryLine {
  productName: string
  variantLabel: string
  quantity: number
}

export interface OrderPlacedNotification {
  orderRef: string
  /** Ordering org / customer display name. */
  customerName: string
  orderType: 'stock_on_hand' | 'purchase_order'
  totalAmount: number
  /** Absolute portal deep link to the order. */
  orderUrl: string
  lines: OrderPlacedSummaryLine[]
}

const ORDER_TYPE_LABEL: Record<OrderPlacedNotification['orderType'], string> = {
  stock_on_hand: 'Stock on hand',
  purchase_order: 'Purchase order',
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

function hasVariant(label: string): boolean {
  const v = label.trim()
  return v.length > 0 && v !== '-' && v !== '—'
}

/** Compact one-line-per-item summary shared by the Slack + email bodies. */
export function summariseOrderLines(lines: OrderPlacedSummaryLine[]): string {
  if (lines.length === 0) return '—'
  return lines
    .map((l) => `• ${l.productName}${hasVariant(l.variantLabel) ? ` (${l.variantLabel})` : ''} ×${l.quantity}`)
    .join('\n')
}

export function buildOrderPlacedSlackMessage(
  n: OrderPlacedNotification,
): { text: string; blocks: unknown[] } {
  const text = `New order ${n.orderRef} — ${n.customerName} — ${formatMoney(n.totalAmount)}`
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `New order ${n.orderRef}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Customer:*\n${n.customerName}` },
        { type: 'mrkdwn', text: `*Type:*\n${ORDER_TYPE_LABEL[n.orderType]}` },
        { type: 'mrkdwn', text: `*Total:*\n${formatMoney(n.totalAmount)}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Items*\n${summariseOrderLines(n.lines)}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open order' },
          url: n.orderUrl,
        },
      ],
    },
  ]
  return { text, blocks }
}

export async function postOrderPlacedSlack(
  n: OrderPlacedNotification,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const webhookUrl = process.env.SLACK_PORTAL_WEBHOOK_URL
  if (!webhookUrl) return { ok: true, skipped: true }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOrderPlacedSlackMessage(n)),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const error = `Slack webhook HTTP ${res.status}: ${body}`
      console.error('[Checkout] order-placed Slack notification failed (swallowed)', error)
      return { ok: false, error }
    }
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[Checkout] order-placed Slack notification failed (swallowed)', error)
    return { ok: false, error }
  }
}
