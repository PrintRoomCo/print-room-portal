/**
 * Email client via Resend API
 *
 * Uses fetch() directly — no npm packages needed.
 */

const RESEND_API_URL = 'https://api.resend.com'
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'The Print Room <hello@theprint-room.co.nz>'

function getApiKey(): string {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not configured')
  return key
}

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
}

export interface SendEmailResult {
  success: boolean
  error?: string
}

/**
 * Send an email via Resend.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = getApiKey()

  try {
    const response = await fetch(`${RESEND_API_URL}/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    })

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>
      const errorMsg = (errorData.message as string) || `HTTP ${response.status}`
      console.error('[Email] Failed to send:', errorMsg)
      return { success: false, error: errorMsg }
    }

    const result = (await response.json()) as Record<string, unknown>
    console.log('[Email] Sent successfully:', {
      id: result.id,
      to: params.to,
      subject: params.subject,
    })
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Email] Exception:', msg)
    return { success: false, error: msg }
  }
}
