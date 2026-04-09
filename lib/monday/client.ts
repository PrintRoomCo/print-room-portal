/**
 * Monday.com GraphQL API Client
 *
 * Shared client for all Monday.com integrations.
 * Uses fetch() directly — no npm packages needed.
 */

const MONDAY_API_URL = 'https://api.monday.com/v2'

function getToken(): string {
  let token = process.env.MONDAY_API_TOKEN || ''
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }
  if (!token) {
    throw new Error('MONDAY_API_TOKEN is not configured')
  }
  return token
}

export interface MondayApiResponse<T = unknown> {
  data: T
  errors?: Array<{ message: string }>
}

/**
 * Execute a Monday.com GraphQL query/mutation.
 * Throws on HTTP errors or GraphQL errors.
 */
export async function mondayApiCall<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = getToken()

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Monday API HTTP ${response.status}: ${text}`)
  }

  const result: MondayApiResponse<T> = await response.json()

  if (result.errors && result.errors.length > 0) {
    console.error('[Monday] GraphQL errors:', result.errors)
    throw new Error(`Monday GraphQL error: ${result.errors[0].message}`)
  }

  // Log rate limit warnings if present
  const remaining = response.headers.get('x-ratelimit-remaining')
  if (remaining && parseInt(remaining, 10) < 100) {
    console.warn(`[Monday] Rate limit low: ${remaining} remaining`)
  }

  return result.data
}
