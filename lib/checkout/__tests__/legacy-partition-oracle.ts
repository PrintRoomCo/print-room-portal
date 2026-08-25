import type { CheckoutLineInput } from '../submit'

export function legacyPartitionOracle(lines: CheckoutLineInput[]): CheckoutLineInput[][] {
  const purchaseOrder = lines.filter((line) => line.fulfilment_type !== 'stocked')
  const stock = lines.filter((line) => line.fulfilment_type === 'stocked')
  return [purchaseOrder, stock].filter((partition) => partition.length > 0)
}
