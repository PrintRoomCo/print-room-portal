import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuoteBuilder } from '../QuoteBuilder'

vi.mock('../GarmentLinesForm', () => ({
  GarmentLinesForm: ({ onOpenDesignPicker }: { onOpenDesignPicker: (lineIdx: number, decoIdx: number) => void }) => (
    <button type="button" onClick={() => onOpenDesignPicker(0, 0)}>
      Open design picker
    </button>
  ),
}))

vi.mock('../SummaryPanel', () => ({
  SummaryPanel: () => null,
}))

vi.mock('../CustomerDetailsModal', () => ({
  CustomerDetailsModal: () => null,
}))

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response)
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/products')) {
        return jsonResponse({
          products: [],
          productTypes: [],
          markupTiers: [],
        })
      }
      if (url.includes('/decorations')) {
        return jsonResponse({
          types: [],
          pricingTiers: [],
          locations: [],
        })
      }
      if (url.includes('/designs')) {
        return jsonResponse({
          designs: [{ id: 'design-1', name: 'Classic crest', imageUrl: null }],
        })
      }
      return jsonResponse({})
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('QuoteBuilder design picker modal', () => {
  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<QuoteBuilder />)

    const trigger = await screen.findByRole('button', { name: /open design picker/i })
    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: /choose a standard design/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /choose a standard design/i })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
