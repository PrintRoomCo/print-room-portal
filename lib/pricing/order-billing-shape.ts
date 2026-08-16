import { partitionByFulfilment, type CheckoutOrderType } from '@/lib/checkout/partition'
import { isPrepaidDrawn } from '@/lib/shop/prepaid-tag'
import type { BillingMode } from '@/lib/shop/billing-mode'
import type { CartLineFulfilmentType } from '@/lib/cart/types'
import { orderPickingFee } from './order-picking-fee'
import { round2 } from './pricingMath'

export interface BilledLineInput {
  /** Stable cart line id — how a caller maps a shaped line back to its own row. */
  lineId: string
  qty: number
  /** Garment unit price, ex decoration (CartLine.unitPrice). */
  unitPrice: number
  /** Folded decoration per garment (lib/cart/types decorationPerUnit). */
  decorationPerUnit: number
  /** The CHOSEN mode. Absent (legacy line) → purchase order, never zeroed. */
  fulfilmentType?: CartLineFulfilmentType
  /** FRESH variant billing mode. null → invoice_on_dispatch (fail closed). */
  billingMode: BillingMode | null
}

export interface BilledLine extends BilledLineInput {
  /** false ⇒ a prepaid stock draw: already paid for, invoiced at $0. */
  billed: boolean
  /** The all-in unit price as invoiced: 0 when !billed. */
  billedUnitPrice: number
  /**
   * qty × all-in unit price at CURRENT catalogue price. ALWAYS the full value,
   * billed or not — it drives both the struck-through display figure and the
   * picking-fee band (D2).
   */
  goodsValue: number
}

export interface BilledPartition {
  orderType: CheckoutOrderType
  lines: BilledLine[]
  /**
   * Full goods value of EVERY line in this partition, pre-zeroing — the
   * picking-fee band basis (D2: the ordering event, at current catalogue price).
   * Per-partition, because the server bands each submitted order separately.
   */
  goodsValueForBand: number
  /** Goods actually invoiced. Prepaid draws contribute 0. */
  billedSubtotal: number
  /**
   * Goods NOT invoiced because they were drawn from prepaid stock. Rendered as
   * "Drawn from pre-paid stock": once the goods line reads $0 this is the only
   * place goodsValueForBand appears, and without it the customer cannot derive
   * why the fee is $15 rather than $35.
   */
  prepaidGoodsValue: number
  pickingFee: number
  gst: number
  total: number
}

export interface BilledOrderShape {
  partitions: BilledPartition[]
  /** Sum of every partition total, inc GST. What the customer pays. */
  grandTotal: number
  /** Sum of every partition's billedSubtotal, ex-GST. The deposit basis. */
  billedSubtotal: number
  /** One Xero quote per partition. 2 ⇒ "You'll receive 2 invoices." */
  invoiceCount: number
  /** Echoed back so the UI can label the GST row without a second source. */
  gstRate: number
}

/** Customer-facing all-in unit price: garment plus any folded decoration. */
export function allInUnitPriceOf(line: BilledLineInput): number {
  const deco = Number.isFinite(line.decorationPerUnit) ? Math.max(0, line.decorationPerUnit) : 0
  return line.unitPrice + deco
}

/**
 * The billed shape of a checkout cart: what each line is invoiced at, how the
 * cart splits into orders, and each order's fee, GST and total.
 *
 * Single source of truth for the customer-facing billed figures, shared by
 * /checkout and /checkout/review so the number the customer agrees to is the
 * number that reaches the Xero draft. Same rationale as order-picking-fee.ts,
 * one layer up.
 *
 * This PREDICTS the server; it is not the authority. submit.ts re-resolves
 * billing modes from variant_inventory and draft-invoice.ts still gates zeroing
 * on qty_from_stock > 0. Prediction is safe because the PDP caps a stock-on-hand
 * line at available stock and the no-partial-draw rule turns a short prepaid
 * order into a separate MOQ purchase order — so 'stocked' implies the line draws
 * its FULL quantity. A stock race between cart and submit is already caught by
 * the existing OUT_OF_STOCK 409.
 *
 * Rounding mirrors computeOrderBreakdown: round each line, then round the sum.
 */
export function billedOrderShape(input: {
  lines: BilledLineInput[]
  gstRate: number
  shipCountry: string | null | undefined
  /** organizations.region — threaded to the picking-fee gate. Null/unknown = NZ. */
  orgRegion?: string | null
}): BilledOrderShape {
  const partitions = partitionByFulfilment(
    input.lines,
    (line) => line.fulfilmentType === 'stocked',
  ).map(({ orderType, lines }): BilledPartition => {
    const shaped = lines.map((line): BilledLine => {
      const billed = !isPrepaidDrawn(line.fulfilmentType, line.billingMode)
      const allIn = allInUnitPriceOf(line)
      return {
        ...line,
        billed,
        billedUnitPrice: billed ? allIn : 0,
        goodsValue: round2(line.qty * allIn),
      }
    })

    const goodsValueForBand = round2(shaped.reduce((total, l) => total + l.goodsValue, 0))
    const billedSubtotal = round2(
      shaped.reduce((total, l) => (l.billed ? total + l.goodsValue : total), 0),
    )
    const prepaidGoodsValue = round2(
      shaped.reduce((total, l) => (l.billed ? total : total + l.goodsValue), 0),
    )
    // Only a stock_on_hand order can carry a fee; a purchase order always gets 0.
    const pickingFee = orderPickingFee({
      isStockOnHand: orderType === 'stock_on_hand',
      shipCountry: input.shipCountry,
      goodsSubtotal: goodsValueForBand,
      orgRegion: input.orgRegion ?? null,
    })
    const gst = round2((billedSubtotal + pickingFee) * input.gstRate)

    return {
      orderType,
      lines: shaped,
      goodsValueForBand,
      billedSubtotal,
      prepaidGoodsValue,
      pickingFee,
      gst,
      total: round2(billedSubtotal + pickingFee + gst),
    }
  })

  return {
    partitions,
    grandTotal: round2(partitions.reduce((total, p) => total + p.total, 0)),
    billedSubtotal: round2(partitions.reduce((total, p) => total + p.billedSubtotal, 0)),
    invoiceCount: partitions.length,
    gstRate: input.gstRate,
  }
}
