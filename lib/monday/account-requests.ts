/**
 * Monday.com Account Requests Integration
 *
 * Creates items on the Account Requests board (5025872532)
 * when a new B2B access request is submitted.
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse } from './types'

const BOARD_ID = process.env.MONDAY_ACCOUNT_REQUESTS_BOARD_ID || '5025872532'

export interface AccountRequestData {
  fullName: string
  email: string
  companyName?: string | null
  phone?: string | null
  customerType?: string | null
  industry?: string | null
  estimatedVolume?: string | null
  message?: string | null
}

/**
 * Create a Monday item for a new account request.
 * Fire-and-forget — callers should catch errors.
 */
export async function createAccountRequestItem(
  data: AccountRequestData
): Promise<{ itemId: string; itemName: string }> {
  const itemName = data.companyName
    ? `${data.companyName} - ${data.fullName}`
    : data.fullName

  const details: string[] = [
    'ACCOUNT REQUEST:',
    `Name: ${data.fullName}`,
    `Email: ${data.email}`,
  ]
  if (data.companyName) details.push(`Company: ${data.companyName}`)
  if (data.phone) details.push(`Phone: ${data.phone}`)
  if (data.customerType) details.push(`Type: ${data.customerType}`)
  if (data.industry) details.push(`Industry: ${data.industry}`)
  if (data.estimatedVolume) details.push(`Est. Volume: ${data.estimatedVolume}`)
  if (data.message) {
    details.push('')
    details.push('MESSAGE:')
    details.push(data.message)
  }
  details.push('')
  details.push('SOURCE: B2B Portal - Account Request')
  details.push(`Submitted: ${new Date().toLocaleString('en-NZ')}`)

  // Column values — using email + long_text columns on the board
  const columnValues: Record<string, unknown> = {}

  // Email column
  const emailColumnId = process.env.MONDAY_COLUMN_ACCT_EMAIL_ID || 'email'
  columnValues[emailColumnId] = { email: data.email, text: data.email }

  // Details long text column
  const detailsColumnId = process.env.MONDAY_COLUMN_ACCT_DETAILS_ID || 'long_text'
  columnValues[detailsColumnId] = { text: details.join('\n') }

  const mutation = `
    mutation CreateAccountRequest($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
        name
      }
    }
  `

  const result = await mondayApiCall<MondayCreateItemResponse>(mutation, {
    boardId: BOARD_ID,
    itemName,
    columnValues: JSON.stringify(columnValues),
  })

  console.log('[Monday AccountRequests] Created item:', result.create_item.id)

  return {
    itemId: result.create_item.id,
    itemName: result.create_item.name,
  }
}
