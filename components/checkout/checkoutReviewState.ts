import type { CartLine } from '@/lib/cart/types'

export interface CustomAddress {
  name: string
  address: string
  city: string
  postal_code: string
  country: string
}

export interface CheckoutReviewState {
  idempotencyKey: string
  requiredBy: string
  notes: string
  intent: 'customer' | 'inventory'
  perLineShipTo: Record<string, string | null>
  customAddress: CustomAddress
  createdAt: string
  partitionOutcomes?: Record<string, StoredPartitionOutcome>
}

export type StoredPartitionOutcome =
  | {
      ok: true
      partitionKey: string
      orderId: string
      orderRef: string
    }
  | {
      ok: false
      partitionKey: string
      code: string
      error: string
    }

export const CHECKOUT_REVIEW_STORAGE_KEY = 'pr-checkout-review-state'

export const EMPTY_CUSTOM_ADDRESS: CustomAddress = {
  name: '',
  address: '',
  city: '',
  postal_code: '',
  country: 'NZ',
}

export function writeCheckoutReviewState(state: CheckoutReviewState) {
  sessionStorage.setItem(CHECKOUT_REVIEW_STORAGE_KEY, JSON.stringify(state))
}

export function readCheckoutReviewState(): CheckoutReviewState | null {
  const raw = sessionStorage.getItem(CHECKOUT_REVIEW_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<CheckoutReviewState>
    if (!parsed.idempotencyKey || !parsed.perLineShipTo || !parsed.customAddress) {
      return null
    }
    return {
      idempotencyKey: parsed.idempotencyKey,
      requiredBy: parsed.requiredBy ?? '',
      notes: parsed.notes ?? '',
      intent: parsed.intent === 'inventory' ? 'inventory' : 'customer',
      perLineShipTo: parsed.perLineShipTo,
      customAddress: {
        ...EMPTY_CUSTOM_ADDRESS,
        ...parsed.customAddress,
      },
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      partitionOutcomes:
        parsed.partitionOutcomes && typeof parsed.partitionOutcomes === 'object'
          ? parsed.partitionOutcomes
          : {},
    }
  } catch {
    return null
  }
}

export function clearCheckoutReviewState() {
  sessionStorage.removeItem(CHECKOUT_REVIEW_STORAGE_KEY)
}

export function allLinesUseCustomAddress(
  lines: CartLine[],
  perLineShipTo: Record<string, string | null>,
) {
  return lines.length > 0 && lines.every((line) => perLineShipTo[line.lineId] === null)
}
