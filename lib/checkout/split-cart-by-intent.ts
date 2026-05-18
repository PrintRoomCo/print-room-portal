/**
 * Minimal shape the splitter reads off each line. Callers can pass any richer
 * line type (e.g. `CheckoutLineInput`) — TypeScript accepts it structurally
 * and the result preserves the input element type via the generic.
 */
export interface SplitInputLine {
  route_to_inventory?: boolean
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
export function splitCartByIntent<T extends SplitInputLine>(input: {
  lines: T[]
  fastPathEntireOrderToInventory: boolean
}): { customer: T[]; inventory: T[] } {
  const { lines, fastPathEntireOrderToInventory } = input

  if (fastPathEntireOrderToInventory) {
    return { customer: [], inventory: [...lines] }
  }

  const customer: T[] = []
  const inventory: T[] = []
  for (const line of lines) {
    if (line.route_to_inventory === true) {
      inventory.push(line)
    } else {
      customer.push(line)
    }
  }
  return { customer, inventory }
}
