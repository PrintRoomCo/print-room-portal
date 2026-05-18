import type { CheckoutLineInput } from '@/lib/checkout/submit'

export interface SplitInput {
  lines: CheckoutLineInput[]
  fastPathEntireOrderToInventory: boolean
}

export interface SplitResult {
  /** Lines destined for the customer-ship order. Empty when fast-path is on. */
  customer: CheckoutLineInput[]
  /** Lines destined for the inventory-routed sibling order. Empty when no flags and fast-path is off. */
  inventory: CheckoutLineInput[]
}

/**
 * Pure split of a checkout line list into customer-ship vs inventory buckets.
 *
 * - When `fastPathEntireOrderToInventory` is true, every line goes to
 *   `inventory` and `customer` is empty.
 * - Otherwise, lines with `route_to_inventory === true` go to `inventory`;
 *   the rest go to `customer`.
 *
 * No side effects, no I/O. Empty input returns two empty buckets.
 */
export function splitCartByIntent(input: SplitInput): SplitResult {
  const { lines, fastPathEntireOrderToInventory } = input

  if (fastPathEntireOrderToInventory) {
    return { customer: [], inventory: [...lines] }
  }

  const customer: CheckoutLineInput[] = []
  const inventory: CheckoutLineInput[] = []
  for (const line of lines) {
    if (line.route_to_inventory === true) {
      inventory.push(line)
    } else {
      customer.push(line)
    }
  }
  return { customer, inventory }
}
