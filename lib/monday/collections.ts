/**
 * Monday.com Collections Integration
 *
 * Creates items + sub-items on the Collections board (5025641710)
 * when a design collection is submitted.
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse, MondayCreateSubitemResponse } from './types'
import type { CollectionWithDesigns, DesignSubmission } from '@/lib/collections'

const BOARD_ID = process.env.MONDAY_COLLECTIONS_BOARD_ID || '5025641710'

export interface MondayCollectionCustomer {
  email: string
  name: string
  company?: string
}

/**
 * Create a Monday item for a submitted collection.
 * Returns the Monday item ID to store on the collection record.
 */
export async function createMondayCollectionItem(
  collection: CollectionWithDesigns,
  customer: MondayCollectionCustomer
): Promise<{ itemId: string; itemName: string }> {
  const itemName = customer.company
    ? `${customer.company} - ${collection.name}`
    : `${customer.name} - ${collection.name}`

  const businessDetails = formatBusinessDetails(collection, customer)
  const collectionDetails = formatCollectionDetails(collection)

  // Column values using confirmed column IDs from board 5025641710
  const columnValues: Record<string, unknown> = {}

  // Collection ID (text) — for webhook correlation
  const collIdCol = process.env.MONDAY_COLUMN_COLLECTION_ID || 'text_mkyqkkgy'
  columnValues[collIdCol] = collection.id

  // Customer Email (email)
  const emailCol = process.env.MONDAY_COLUMN_CUSTOMER_EMAIL_ID || 'email_mkyqm2tc'
  columnValues[emailCol] = { email: customer.email, text: customer.email }

  // Catalog ID (text) — for Shopify publishing
  if (collection.catalog_id) {
    const catalogCol = process.env.MONDAY_COLUMN_COLLECTION_CATALOG_ID || 'text_mkyq71dx'
    columnValues[catalogCol] = collection.catalog_id
  }

  // Business Details (long text)
  const bizCol = process.env.MONDAY_COLUMN_BUSINESS_DETAILS_ID || 'long_text_mkyqwv50'
  columnValues[bizCol] = { text: businessDetails }

  // Collection Details (long text)
  const detCol = process.env.MONDAY_COLUMN_COLLECTION_DETAILS_ID || 'long_text_mkyqj5na'
  columnValues[detCol] = { text: collectionDetails }

  const mutation = `
    mutation CreateCollectionItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
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

  console.log('[Monday Collections] Created item:', result.create_item.id)

  return {
    itemId: result.create_item.id,
    itemName: result.create_item.name,
  }
}

/**
 * Create a sub-item for each design in the collection.
 * Called sequentially with a small delay to avoid rate limits.
 */
export async function createMondayDesignSubitems(
  parentItemId: string,
  designs: DesignSubmission[]
): Promise<void> {
  for (const design of designs) {
    try {
      await createDesignSubitem(parentItemId, design)
      // Small delay between sub-item creations to be kind to Monday API
      await new Promise((resolve) => setTimeout(resolve, 300))
    } catch (error) {
      console.error(
        `[Monday Collections] Failed to create sub-item for design ${design.id}:`,
        error
      )
      // Continue with remaining designs — don't fail the whole batch
    }
  }
}

async function createDesignSubitem(
  parentItemId: string,
  design: DesignSubmission
): Promise<{ subitemId: string }> {
  // Sub-item column IDs (subitems board 5025647256)
  const columnValues: Record<string, unknown> = {
    text_mkyry6ra: design.id, // Design ID
    status: { index: 0 }, // Pending Review
  }

  const mutation = `
    mutation CreateDesignSubitem($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
      create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) {
        id
        name
      }
    }
  `

  const result = await mondayApiCall<MondayCreateSubitemResponse>(mutation, {
    parentItemId,
    itemName: design.design_name,
    columnValues: JSON.stringify(columnValues),
  })

  console.log('[Monday Collections] Created sub-item:', result.create_subitem.id)

  return { subitemId: result.create_subitem.id }
}

function formatBusinessDetails(
  collection: CollectionWithDesigns,
  customer: MondayCollectionCustomer
): string {
  const lines: string[] = [
    'CONTACT INFORMATION:',
    `Name: ${customer.name}`,
  ]
  if (customer.company) lines.push(`Company: ${customer.company}`)
  lines.push(`Email: ${customer.email}`)
  lines.push('')
  lines.push('COLLECTION DETAILS:')
  lines.push(`Collection Name: ${collection.name}`)
  if (collection.description) lines.push(`Description: ${collection.description}`)
  lines.push(`Design Count: ${collection.design_count}`)
  lines.push(`Submitted: ${new Date().toLocaleString('en-NZ')}`)
  lines.push('')
  lines.push('SOURCE: B2B Portal - Design Collections')
  if (collection.catalog_id) lines.push(`Catalog ID: ${collection.catalog_id}`)

  return lines.join('\n')
}

function formatCollectionDetails(collection: CollectionWithDesigns): string {
  const lines: string[] = [
    `COLLECTION: ${collection.name}`,
    '',
    'DESIGNS IN COLLECTION:',
  ]

  collection.designs.forEach((design, index) => {
    lines.push(`${index + 1}. ${design.design_name}`)
    lines.push(`   Design ID: ${design.design_id}`)

    if (design.pricing_data) {
      const pricing = design.pricing_data as Record<string, unknown>
      if (pricing.total) {
        lines.push(`   Est. Price: $${(pricing.total as number).toFixed(2)}`)
      }
    }

    if (design.images && design.images.length > 0) {
      lines.push(`   Images: ${design.images.length} attached`)
    }

    lines.push('')
  })

  lines.push('SUMMARY:')
  lines.push(`Total Designs: ${collection.design_count}`)
  lines.push(`Collection ID: ${collection.id}`)

  return lines.join('\n')
}
