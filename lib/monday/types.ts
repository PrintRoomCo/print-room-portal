/**
 * Shared Monday.com types
 */

export interface MondayColumnValue {
  id: string
  text: string | null
  value: string | null
}

export interface MondayItem {
  id: string
  name: string
  column_values: MondayColumnValue[]
}

export interface MondayBoardItemsResponse {
  boards: Array<{
    items_page: {
      items: MondayItem[]
    }
  }>
}

export interface MondayCreateItemResponse {
  create_item: {
    id: string
    name: string
  }
}

export interface MondayCreateSubitemResponse {
  create_subitem: {
    id: string
    name: string
  }
}

export interface MondayChangeColumnResponse {
  change_column_value: {
    id: string
  }
}

export interface MondayCreateUpdateResponse {
  create_update: {
    id: string
  }
}

export interface MondayItemsByColumnResponse {
  items_page_by_column_values: {
    items: MondayItem[]
  }
}
