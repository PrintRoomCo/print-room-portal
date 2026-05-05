export interface CartLine {
  lineId: string
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  qty: number
  unitPrice: number
  imageUrl: string | null
  shipToStoreId?: string | null
  /**
   * Snapshot of resolved decoration price at add-time:
   * catalogue override OR master fallback. Null when the product has no decoration.
   */
  decorationPrice?: number | null
}

export interface CartState {
  lines: CartLine[]
}
