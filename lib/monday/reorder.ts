/**
 * Monday.com Reorder Integration
 *
 * Creates items on the Reorders board when a customer
 * requests to reorder a completed project.
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse } from './types'

const BOARD_ID = process.env.MONDAY_REORDERS_BOARD_ID || '5025641710'

export interface ReorderData {
  customerEmail: string
  customerName: string
  companyName?: string | null
  originalQuoteNumber: string | null
  originalJobReference: string | null
  mondayProjectName?: string | null
  proofFiles: Array<{ name: string; url: string }>
  changes: string
}

/**
 * Create a Monday item for a reorder request.
 * Fire-and-forget — callers should catch errors.
 */
export async function createReorderItem(
  data: ReorderData
): Promise<{ itemId: string; itemName: string }> {
  const projectLabel = data.mondayProjectName || data.originalQuoteNumber || 'Unknown Project'
  const itemName = `REORDER — ${projectLabel}`

  const details: string[] = [
    'REORDER REQUEST:',
    `Customer: ${data.customerName}`,
    `Email: ${data.customerEmail}`,
  ]
  if (data.companyName) details.push(`Company: ${data.companyName}`)
  if (data.originalQuoteNumber) details.push(`Original Quote: ${data.originalQuoteNumber}`)
  if (data.originalJobReference) details.push(`Original Job Ref: ${data.originalJobReference}`)

  if (data.proofFiles.length > 0) {
    details.push('')
    details.push('PROOF FILES:')
    data.proofFiles.forEach((file) => {
      details.push(`- ${file.name}: ${file.url}`)
    })
  }

  if (data.changes.trim()) {
    details.push('')
    details.push('CHANGES / NOTES:')
    details.push(data.changes)
  }

  details.push('')
  details.push('SOURCE: B2B Portal - Reorder')
  details.push(`Submitted: ${new Date().toLocaleString('en-NZ')}`)

  // Column values — using email + long_text columns on the board
  const columnValues: Record<string, unknown> = {}

  const emailColumnId = process.env.MONDAY_COLUMN_REORDER_EMAIL_ID || 'email'
  columnValues[emailColumnId] = { email: data.customerEmail, text: data.customerEmail }

  const detailsColumnId = process.env.MONDAY_COLUMN_REORDER_DETAILS_ID || 'long_text'
  columnValues[detailsColumnId] = { text: details.join('\n') }

  const mutation = `
    mutation CreateReorder($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
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

  console.log('[Monday Reorder] Created item:', result.create_item.id)

  return {
    itemId: result.create_item.id,
    itemName: result.create_item.name,
  }
}
