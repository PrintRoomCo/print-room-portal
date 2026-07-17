import { describe, expect, it } from 'vitest'
import { buildLineItemsCsv, buildOrdersCsv, type PastOrderLineItem } from '@/lib/orders/past-orders-csv'
import type { PortalPastOrder } from '@/lib/orders/past-orders-query'

function order(overrides: Partial<PortalPastOrder>): PortalPastOrder {
  return {
    orderId: 'ord-aaaa',
    quoteId: 'quote-1',
    orderRef: 'ANFI-000083',
    quoteNumber: 'Q-1',
    reference: null,
    status: 'shipped',
    orderType: 'purchase_order',
    customerName: 'Buyer',
    customerEmail: 'buyer@example.com',
    customerCompany: 'Anytime Fitness',
    subtotal: 100,
    totalAmount: 115,
    currency: 'NZD',
    pickingFee: 0,
    billed: 100,
    createdAt: '2026-07-10T03:04:05.000Z',
    tracking: null,
    ...overrides,
  }
}

const ORDER_HEADER =
  'order_ref,placed_at,placed_by,order_type,status,product_value_ex_gst,picking_fee,billed_ex_gst,currency'

describe('buildOrdersCsv', () => {
  it('emits BOM + CRLF + header + one row per order', () => {
    const csv = buildOrdersCsv([order({})])
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain('\r\n')
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines[0]).toBe(ORDER_HEADER)
    expect(lines[1]).toBe('ANFI-000083,2026-07-10,buyer@example.com,purchase_order,shipped,100,0,100,NZD')
    expect(lines).toHaveLength(2)
  })

  it('falls back order_ref → reference → quoteNumber, and escapes commas/quotes', () => {
    const csv = buildOrdersCsv([
      order({ orderRef: null, reference: null, quoteNumber: 'Q "big", one' }),
    ])
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines[1].startsWith('"Q ""big"", one",')).toBe(true)
  })
})

describe('buildLineItemsCsv', () => {
  const items = new Map<string, PastOrderLineItem[]>([
    [
      'quote-1',
      [
        {
          quote_id: 'quote-1',
          product_name: 'Staple Tee',
          size_label: 'M',
          quantity: 10,
          unit_price: 10,
          total_price: 100,
          qty_from_stock: 10,
          qty_to_make: 0,
          ship_to_store_id: 'store-1',
        },
      ],
    ],
  ])
  const storeNames = new Map([['store-1', 'Invercargill']])

  it('emits one row per line item with order fields repeated and store name resolved', () => {
    const csv = buildLineItemsCsv([order({})], items, storeNames)
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      `${ORDER_HEADER},product_name,size_label,quantity,unit_price,line_total,qty_from_stock,qty_to_make,ship_to_store`,
    )
    expect(lines[1]).toBe(
      'ANFI-000083,2026-07-10,buyer@example.com,purchase_order,shipped,100,0,100,NZD,Staple Tee,M,10,10,100,10,0,Invercargill',
    )
  })

  it('an order with no line items still gets one row (never silently dropped)', () => {
    const csv = buildLineItemsCsv([order({ quoteId: 'quote-none' })], items, storeNames)
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1].startsWith('ANFI-000083,')).toBe(true)
  })
})
