import { describe, expect, it } from 'vitest'

import {
  buildProofDocumentFromOrderRows,
  type DecorationLinkDetail,
  type OrderProofLineRow,
} from './order-assembly'

function link(id: string): DecorationLinkDetail {
  return {
    id,
    catalogue_item_id: 'item-hoodie',
    org_decoration_id: 'decoration-logo',
    snapshot_url: 'https://example.test/live-default-mockup.png',
    decoration: {
      id: 'decoration-logo',
      name: 'Screen print — Left Chest',
      decoration_method: 'screenprint',
      artwork: {
        id: 'artwork-black',
        name: 'Print Room Logo — Black',
        public_url: 'https://example.test/live-default-black.png',
      },
    },
    print_area: {
      id: 'left-chest',
      view: 'front',
      name: 'Left Chest',
      width_mm: 80,
      height_mm: 58,
    },
  }
}

function line(args: {
  id: string
  linkId: string
  variantId: string
  colour: string
  renditionId: string
  renditionLabel: string
  artworkId: string
  artworkName: string
  artworkUrl: string
  sha256: string
}): OrderProofLineRow {
  return {
    id: args.id,
    product_id: 'hoodie',
    product_name: 'Hoodie',
    quantity: 12,
    unit_price: 40,
    variant_id: args.variantId,
    size_label: 'M',
    product_variants: {
      id: args.variantId,
      color_swatch_id: `swatch-${args.colour.toLowerCase()}`,
      product_color_swatches: { label: args.colour, hex: null },
    },
    decorations: [{
      linkId: args.linkId,
      decorationId: 'decoration-logo',
      name: 'Screen print — Left Chest',
      method: 'screenprint',
      positionLabel: 'Left Chest',
      unitPrice: 4,
      renditionId: args.renditionId,
      renditionLabel: args.renditionLabel,
      artworkId: args.artworkId,
      artworkName: args.artworkName,
      artworkUrl: args.artworkUrl,
      renditionArtworkSha256: args.sha256,
      renditionProductVariantId: args.variantId,
      renditionResolutionToken: `token-${args.renditionId}`,
      snapshotUrl: null,
    }],
  }
}

describe('buildProofDocumentFromOrderRows artwork renditions', () => {
  it('splits one decoration into production designs by purchased artwork file', () => {
    const result = buildProofDocumentFromOrderRows({
      orderId: 'order-1',
      quote: {
        id: 'quote-1',
        order_ref: 'TPR-1',
        customer_name: 'Print Room',
        customer_email: 'orders@example.test',
        customer_phone: null,
        organization_id: 'org-1',
        required_by: null,
        payment_terms: null,
        notes: null,
        internal_notes: null,
        shipping_address: null,
      },
      organization: { id: 'org-1', name: 'Print Room' },
      lines: [
        line({
          id: 'line-white',
          linkId: 'link-white',
          variantId: 'variant-white',
          colour: 'White',
          renditionId: 'rendition-black',
          renditionLabel: 'Black ink',
          artworkId: 'artwork-black',
          artworkName: 'Print Room Logo — Black',
          artworkUrl: 'https://example.test/purchased-black.png',
          sha256: 'sha-black',
        }),
        line({
          id: 'line-navy',
          linkId: 'link-navy',
          variantId: 'variant-navy',
          colour: 'Navy',
          renditionId: 'rendition-white',
          renditionLabel: 'White ink',
          artworkId: 'artwork-white',
          artworkName: 'Print Room Logo — White',
          artworkUrl: 'https://example.test/purchased-white.png',
          sha256: 'sha-white',
        }),
      ],
      decorationLinksById: new Map([
        ['link-white', link('link-white')],
        ['link-navy', link('link-navy')],
      ]),
      catalogueImagesByItemId: new Map(),
      productImagesByProductId: new Map(),
      transparentArtworkUrlsByArtworkId: new Map([
        ['artwork-black', 'https://example.test/prepared-black.png'],
        ['artwork-white', 'https://example.test/prepared-white.png'],
      ]),
      productBrandInfoByProductId: new Map(),
    })

    expect(result.document.designs).toHaveLength(2)
    expect(result.document.designs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artworkUrl: 'https://example.test/prepared-black.png',
        artworkNotes: expect.stringContaining('Rendition: Black ink'),
      }),
      expect.objectContaining({
        artworkUrl: 'https://example.test/prepared-white.png',
        artworkNotes: expect.stringContaining('Rendition: White ink'),
      }),
    ]))
    expect(result.document.designs.every((design) =>
      design.frontMockupUrl !== 'https://example.test/live-default-mockup.png'
    )).toBe(true)
  })
})
