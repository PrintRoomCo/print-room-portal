export const REORDER_EDITABLE_LINE_ITEMS =
  (process.env.NEXT_PUBLIC_REORDER_EDITABLE_LINE_ITEMS ?? '1') !== '0'

export interface ReorderEditedItem {
  source_index: number
  product_name: string
  color: string | null
  sizes: Record<string, number>
  included: boolean
}

export const MAX_PRODUCT_NAME_LENGTH = 200
export const MAX_COLOR_LENGTH = 100
export const MAX_SIZE_LABEL_LENGTH = 16
export const MAX_SIZE_QTY = 100_000
