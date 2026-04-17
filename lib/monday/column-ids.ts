/**
 * Single source of truth for Monday.com board + column identifiers.
 *
 * Keep all string/number board + column ids here — no inline literals elsewhere.
 */

export const PRODUCTION_BOARD_ID = 1992701981
export const PRODUCTION_SUBITEMS_BOARD_ID = 1992701983
export const SUPPLIERS_INVENTORY_BOARD_ID = 2037468738
export const CHATBOT_INQUIRIES_BOARD_ID = 5026071982

export const PRODUCTION_COLUMNS = {
  customerEmail: 'email_mkqjpxt3',
  poRef: 'text_mkqxcmvz',
  artworkFiles: 'file_mkpesta8',
  proofPdf: 'file_mkqjp7kh',
  completedMedia: 'file_mks0gm29',
  packingSlip: 'file_mks091cy',
  quoteTotal: 'numeric_mkpqavfj',
  mainStatus: 'color_mkpnas0e',
  shippingStatus: 'color_mkqzj6fv',
  trackingUrl: 'link_mkqz77w0',
  promiseDate: 'date_mkrrgxzh',
  shipDate: 'date4',
  trackerUrl: 'text_mkxvmsha',
  decorationMethods: 'dropdown_mkq4q0wq',
} as const

export const PRODUCTION_SUBITEM_COLUMNS = {
  garmentRelation: 'board_relation_mksyrn6n',
  skuMirror: 'lookup_mksysbq',
  colorMirror: 'lookup_mksy5bqh',
  fallbackSku: 'text_mkqj56x0',
  fallbackGarment: 'text_mkqj1fhk',
  fallbackColor: 'text_mkrs49mc',
  brand: 'color_mkrjvgbj',
  stockStatus: 'color_mks0tbch',
  formulaTotal: 'formula_mkqjvyvb',
  sizes: {
    ONE: 'numeric_mkr4e98d',
    '2': 'numeric_mktvgvgd',
    '4': 'numeric_mktvjq7r',
    XXS: 'numeric_mkqjwcda',
    XS: 'numeric_mkqjzg1z',
    S: 'numeric_mkqjx0fy',
    M: 'numeric_mkqjaby1',
    L: 'numeric_mkqjk7gk',
    XL: 'numeric_mkqjax2t',
    '2XL': 'numeric_mkqjx3gm',
    '3XL': 'numeric_mkqj4vny',
    '4XL': 'numeric_mkqj7r66',
    '5XL': 'numeric_mkqjcnb',
    '4-8': 'numeric_mkv0s747',
    '9-13': 'numeric_mkv0mjq9',
    '0-3M': 'numeric_mkv0h7q1',
    '3-6M': 'numeric_mkv0xp97',
    '6-12M': 'numeric_mkv0z7g',
    '12-18M': 'numeric_mkv04dg2',
    '18-24M': 'numeric_mkv0a1j9',
  } as const,
} as const

export type ProductionSubitemSizeKey =
  keyof typeof PRODUCTION_SUBITEM_COLUMNS.sizes
