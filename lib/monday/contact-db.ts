/**
 * Monday.com Contact Database Lookup
 *
 * Searches the Contact Database board (1992699935) by email or company name.
 * Returns pricing tier, payment terms, account manager, address, etc.
 */

import { mondayApiCall } from './client'
import type { MondayItemsByColumnResponse } from './types'

const BOARD_ID = process.env.MONDAY_CONTACT_DB_BOARD_ID || '1992699935'

// Column IDs for board 1992699935
const CONTACT_DB_COLUMNS = {
  customerName: 'text_mkpg45yv',
  customerCode: 'text_mkvkzynd',
  pricingTier: 'color_mkqysphb',
  paymentTerms: 'color_mkpgf0zy',
  accManager: 'person',
  email: 'email_mkpgx0bp',
  phone: 'text_mkrvb8cb',
  street: 'text_mkpgwea8',
  city: 'text_mkpw1twp',
  postcode: 'text_mkpxk4j5',
  country: 'text_mkpwj96b',
  suburb: 'text_mkpwswx7',
  building: 'text_mkpwn3sg',
  instructions: 'text_mm0wdgah',
  industryType: 'color_mkpg3cdf',
  customerNotes: 'text_mks0660c',
} as const

const ALL_COLUMN_IDS = Object.values(CONTACT_DB_COLUMNS)

export interface ContactAddress {
  street: string | null
  city: string | null
  postcode: string | null
  country: string | null
  suburb: string | null
  building: string | null
  instructions: string | null
}

export interface ContactRecord {
  mondayItemId: string
  companyName: string
  customerName: string | null
  customerCode: string | null
  pricingTier: string | null
  paymentTerms: string | null
  accountManagerId: string | null
  phone: string | null
  address: ContactAddress
  industryType: string | null
  customerNotes: string | null
}

function getColumnText(
  columnValues: Array<{ id: string; text?: string | null; value?: string | null }>,
  columnId: string
): string | null {
  const col = columnValues.find((c) => c.id === columnId)
  return col?.text || null
}

function getPersonId(
  columnValues: Array<{ id: string; value?: string | null }>,
  columnId: string
): string | null {
  const col = columnValues.find((c) => c.id === columnId)
  if (!col?.value) return null
  try {
    const parsed = JSON.parse(col.value)
    const persons = parsed?.personsAndTeams
    if (Array.isArray(persons) && persons.length > 0) {
      return String(persons[0].id)
    }
  } catch {
    // ignore parse errors
  }
  return null
}

/**
 * Look up a customer in the Monday Contact Database.
 * Searches by email first, falls back to company name.
 */
export async function lookupContactByEmail(
  customerEmail: string,
  customerCompany?: string | null
): Promise<ContactRecord | null> {
  const query = `
    query SearchContactDB($boardId: [ID!]!, $columnId: String!, $value: CompareValue!, $columnIds: [String!]) {
      items_page_by_column_values(
        board_id: $boardId,
        columns: [{ column_id: $columnId, column_values: [$value] }],
        limit: 1
      ) {
        items {
          id
          name
          column_values(ids: $columnIds) {
            id
            text
            value
          }
        }
      }
    }
  `

  async function searchByColumn(
    columnId: string,
    value: string
  ): Promise<ContactRecord | null> {
    try {
      const result = await mondayApiCall<MondayItemsByColumnResponse>(query, {
        boardId: [BOARD_ID],
        columnId,
        value,
        columnIds: ALL_COLUMN_IDS,
      })

      const items = result.items_page_by_column_values?.items
      if (!items || items.length === 0) return null

      const item = items[0]
      const cv = item.column_values as Array<{
        id: string
        text?: string | null
        value?: string | null
      }>

      return {
        mondayItemId: item.id,
        companyName: item.name,
        customerName: getColumnText(cv, CONTACT_DB_COLUMNS.customerName),
        customerCode: getColumnText(cv, CONTACT_DB_COLUMNS.customerCode),
        pricingTier: getColumnText(cv, CONTACT_DB_COLUMNS.pricingTier),
        paymentTerms: getColumnText(cv, CONTACT_DB_COLUMNS.paymentTerms),
        accountManagerId: getPersonId(cv, CONTACT_DB_COLUMNS.accManager),
        phone: getColumnText(cv, CONTACT_DB_COLUMNS.phone),
        address: {
          street: getColumnText(cv, CONTACT_DB_COLUMNS.street),
          city: getColumnText(cv, CONTACT_DB_COLUMNS.city),
          postcode: getColumnText(cv, CONTACT_DB_COLUMNS.postcode),
          country: getColumnText(cv, CONTACT_DB_COLUMNS.country),
          suburb: getColumnText(cv, CONTACT_DB_COLUMNS.suburb),
          building: getColumnText(cv, CONTACT_DB_COLUMNS.building),
          instructions: getColumnText(cv, CONTACT_DB_COLUMNS.instructions),
        },
        industryType: getColumnText(cv, CONTACT_DB_COLUMNS.industryType),
        customerNotes: getColumnText(cv, CONTACT_DB_COLUMNS.customerNotes),
      }
    } catch (error) {
      console.warn('[ContactDB] Search error:', error)
      return null
    }
  }

  // Try email first
  console.log('[ContactDB] Looking up by email:', customerEmail)
  const byEmail = await searchByColumn(CONTACT_DB_COLUMNS.email, customerEmail)
  if (byEmail) {
    console.log('[ContactDB] Found by email:', byEmail.companyName)
    return byEmail
  }

  // Fall back to company name
  if (customerCompany) {
    console.log('[ContactDB] Falling back to company name:', customerCompany)
    const byCompany = await searchByColumn('name', customerCompany)
    if (byCompany) {
      console.log('[ContactDB] Found by company:', byCompany.companyName)
      return byCompany
    }
  }

  console.log('[ContactDB] No match found')
  return null
}
