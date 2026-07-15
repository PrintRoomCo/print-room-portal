import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildOrderPlacedSlackMessage,
  postOrderPlacedSlack,
  type OrderPlacedNotification,
} from '../slack-order-placed'

const SAVED = { ...process.env }
afterEach(() => {
  process.env = { ...SAVED }
  vi.restoreAllMocks()
})

const sample: OrderPlacedNotification = {
  orderRef: 'TPRC-000042',
  customerName: 'Anytime Fitness',
  orderType: 'stock_on_hand',
  totalAmount: 349.5,
  orderUrl: 'https://portal.theprintroom.nz/checkout/confirmation/ord-1',
  lines: [
    { productName: 'Classic Tee', variantLabel: 'Black / M', quantity: 10 },
    { productName: 'Hoodie', variantLabel: '—', quantity: 2 },
  ],
}

describe('buildOrderPlacedSlackMessage', () => {
  it('includes ref, total, deep link, type and item summary in the blocks', () => {
    const { text, blocks } = buildOrderPlacedSlackMessage(sample)
    const json = JSON.stringify(blocks)
    expect(text).toContain('TPRC-000042')
    expect(json).toContain('TPRC-000042')
    expect(json).toContain('$349.50')
    expect(json).toContain('https://portal.theprintroom.nz/checkout/confirmation/ord-1')
    expect(json).toContain('Classic Tee')
    expect(json).toContain('Stock on hand')
  })
})

describe('postOrderPlacedSlack', () => {
  beforeEach(() => {
    delete process.env.SLACK_PORTAL_WEBHOOK_URL
  })

  it('no-ops (no fetch) when SLACK_PORTAL_WEBHOOK_URL is unset', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await postOrderPlacedSlack(sample)
    expect(res).toEqual({ ok: true, skipped: true })
    expect(f).not.toHaveBeenCalled()
  })

  it('POSTs the Block Kit payload to the webhook when set', async () => {
    process.env.SLACK_PORTAL_WEBHOOK_URL = 'https://hooks.slack.test/abc'
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', f)
    const res = await postOrderPlacedSlack(sample)
    expect(res).toEqual({ ok: true })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://hooks.slack.test/abc')
    expect(init.method).toBe('POST')
    expect(init.body).toContain('TPRC-000042')
  })

  it('logs and contains webhook failures without throwing', async () => {
    process.env.SLACK_PORTAL_WEBHOOK_URL = 'https://hooks.slack.test/abc'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    }))

    await expect(postOrderPlacedSlack(sample)).resolves.toEqual({
      ok: false,
      error: 'Slack webhook HTTP 503: unavailable',
    })
    expect(errorSpy).toHaveBeenCalledWith(
      '[Checkout] order-placed Slack notification failed (swallowed)',
      'Slack webhook HTTP 503: unavailable',
    )
  })
})
