import { partitionCheckoutLines, type CheckoutOrderType } from './partition'
import type { CheckoutLineInput } from './submit'

export interface CheckoutExecutionPlanInput {
  idempotencyKey: string
  lines: CheckoutLineInput[]
}

export interface CheckoutExecutionPlanPartition {
  key: CheckoutOrderType
  orderType: CheckoutOrderType
  lines: CheckoutLineInput[]
  idempotencyKey: string
}

export interface CheckoutExecutionPlan {
  partitions: CheckoutExecutionPlanPartition[]
}

export function buildCheckoutExecutionPlan(
  input: CheckoutExecutionPlanInput,
  _countryPartitionEnabled: boolean,
): CheckoutExecutionPlan {
  return {
    partitions: partitionCheckoutLines(input.lines).map((partition) => ({
      key: partition.orderType,
      orderType: partition.orderType,
      lines: partition.lines,
      idempotencyKey: `${input.idempotencyKey}:${
        partition.orderType === 'purchase_order' ? 'po' : 'stock'
      }`,
    })),
  }
}
