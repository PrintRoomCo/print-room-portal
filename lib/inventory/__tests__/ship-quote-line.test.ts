import { describe, expect, it, vi } from 'vitest'
import { shipMondaySubitem } from '../ship-quote-line'

describe('shipMondaySubitem', () => {
  it('ships every size line linked to one product subitem', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const insert = vi.fn().mockResolvedValue({ error: null })

    const matchingRows = {
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Multiple rows returned' },
      }),
      then: (
        resolve: (value: {
          data: Array<{ id: string }>
          error: null
        }) => unknown,
      ) =>
        Promise.resolve({
          data: [{ id: 'qi-small' }, { id: 'qi-medium' }],
          error: null,
        }).then(resolve),
    }

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'quote_items') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => matchingRows),
            })),
          }
        }
        return { insert }
      }),
      rpc,
    } as unknown as Parameters<typeof shipMondaySubitem>[0]

    const result = await shipMondaySubitem(
      supabase,
      'sub-product-1',
      null,
      { event: 'dispatched' },
    )

    expect(result).toEqual({ ok: true, matched: 'subitem_id' })
    expect(rpc).toHaveBeenNthCalledWith(1, 'ship_quote_line', {
      p_quote_item_id: 'qi-small',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'ship_quote_line', {
      p_quote_item_id: 'qi-medium',
    })
    expect(insert).not.toHaveBeenCalled()
  })
})
