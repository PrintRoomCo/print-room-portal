import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/monday/deal-item', () => ({ pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'm', subitemIds: {} }) }))
vi.mock('@/lib/email/order-confirmation', () => ({ sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/proofs/autofill-for-order', () => ({ autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }) }))
vi.mock('@/lib/orders/job-tracker', () => ({ createJobTrackerShellForOrder: vi.fn().mockResolvedValue({ trackerId: 't', trackerToken: 'X' }) }))
vi.mock('@/lib/monday/updates', () => ({ postItemUpdate: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/xero/draft-invoice', () => ({ createDraftInvoiceForOrder: vi.fn().mockResolvedValue({ status: 'skipped', reason: 't' }) }))
import { submitCustomerOrder } from '../submit'
import { makeFanoutStub, makeContext } from './fanout-test-stub'
describe('dbg', () => {
  it('logs', async () => {
    const stub = makeFanoutStub({
      items: [
        { id: 'item-tee', sourceProductId: 'prod-tee', priceMode: 'computed', catalogueId: 'cat-1', poolingEnabled: true },
        { id: 'item-hood', sourceProductId: 'prod-hood', priceMode: 'computed', catalogueId: 'cat-1', poolingEnabled: true },
      ],
      products: [{ id: 'prod-tee' }, { id: 'prod-hood' }],
      links: [
        { id: 'link-tee-A', catalogueItemId: 'item-tee', sourceProductId: 'prod-tee', orgDecoration: { id: 'dec-A', organizationId: 'org-1', name: 'A', unitPrice: 9, artworkId: 'art-1' } },
        { id: 'link-hood-A', catalogueItemId: 'item-hood', sourceProductId: 'prod-hood', orgDecoration: { id: 'dec-A', organizationId: 'org-1', name: 'A', unitPrice: 9, artworkId: 'art-1' } },
      ],
      tier: null, decorationRpcPrice: () => 6, garmentUnitPrice: 12.5,
    })
    const d = (linkId: string) => ({ linkId, decorationId: 'dec-A', name: 'A', method: 'screenprint', positionLabel: null, unitPrice: 6, artworkUrl: null, snapshotUrl: null })
    await submitCustomerOrder(stub.admin, {
      context: makeContext('org-1'), idempotency_key: 'k1',
      lines: [
        { product_id: 'prod-tee', product_name: 'tee', variant_id: null, variant_label: null, qty: 500, fulfilment_type: 'stocked', catalogueItemId: 'item-tee', decorations: [d('link-tee-A')] },
        { product_id: 'prod-hood', product_name: 'hood', variant_id: null, variant_label: null, qty: 100, fulfilment_type: 'made_to_order', catalogueItemId: 'item-hood', decorations: [d('link-hood-A')] },
      ],
    } as never)
    expect(true).toBe(true)
  })
})
