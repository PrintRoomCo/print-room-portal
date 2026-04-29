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
  /** WS4 — snapshot of products.decoration_price at add-time. Null/undefined when product has no decoration. */
  decorationPrice?: number | null
}

export interface CartState {
  lines: CartLine[]
}
