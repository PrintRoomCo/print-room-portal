import {
  partitionByCountryAndFulfilment,
  partitionCheckoutLines,
  type CheckoutOrderType,
} from './partition'
import type { CheckoutLineInput } from './submit'

export type CheckoutExecutionLine = CheckoutLineInput & { ship_country?: string }

export interface CheckoutExecutionPlanInput {
  idempotencyKey: string
  lines: CheckoutExecutionLine[]
  countryOrder?: readonly string[]
}

export interface CheckoutExecutionPlanPartition {
  key: string
  countryCode?: string
  orderType: CheckoutOrderType
  lines: CheckoutExecutionLine[]
  idempotencyKey: string
}

export interface CheckoutExecutionPlan {
  partitions: CheckoutExecutionPlanPartition[]
}

export function buildCheckoutExecutionPlan(
  input: CheckoutExecutionPlanInput,
  countryPartitionEnabled: boolean,
): CheckoutExecutionPlan {
  if (countryPartitionEnabled) {
    const countryPartitions = partitionByCountryAndFulfilment(
      input.lines as Array<
        CheckoutExecutionLine & { fulfilment_type: string; ship_country: string }
      >,
      input.countryOrder,
    )
    const oneCountry = new Set(countryPartitions.map((partition) => partition.countryCode)).size <= 1
    return {
      partitions: countryPartitions.map((partition) => {
        const suffix = partition.orderType === 'purchase_order' ? 'po' : 'stock'
        return {
          key: oneCountry ? partition.orderType : partition.key,
          countryCode: partition.countryCode,
          orderType: partition.orderType,
          lines: partition.lines,
          idempotencyKey: oneCountry
            ? `${input.idempotencyKey}:${suffix}`
            : `${input.idempotencyKey}:${partition.countryCode.toLowerCase()}:${suffix}`,
        }
      }),
    }
  }

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
