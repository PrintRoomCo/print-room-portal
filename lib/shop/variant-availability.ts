export interface VariantAvailability {
  available_qty: number
  allow_order_without_stock: boolean
}

export const NO_AVAILABILITY: VariantAvailability = {
  available_qty: 0,
  allow_order_without_stock: false,
}
