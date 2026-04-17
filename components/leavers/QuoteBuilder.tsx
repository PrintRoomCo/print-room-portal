'use client'

import { useReducer, useEffect, useCallback, useRef } from 'react'
import { z } from 'zod'
import { GarmentLinesForm } from './GarmentLinesForm'
import { SummaryPanel } from './SummaryPanel'
import { CustomerDetailsModal } from './CustomerDetailsModal'

// ─── API ─────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_LEAVERS_API_URL || 'https://print-room-chatbot-api.vercel.app/api/leavers'
const ARTWORK_UPLOAD_URL = process.env.NEXT_PUBLIC_ARTWORK_UPLOAD_URL || 'https://print-room-chatbot-api.vercel.app/api/quote-artwork-upload'

// ─── Zod schemas ─────────────────────────────────────────────────

const decorationSchema = z.object({
  decorationType: z.string().min(1, 'Type is required'),
  detail: z.string().min(1, 'Detail is required'),
  location: z.string().min(1, 'Location is required'),
  decorationColours: z.string().optional().or(z.literal('')),
  artworkType: z.enum(['custom', 'standard']),
  artworkFileId: z.string().optional(),
  standardDesignId: z.string().optional(),
  _artworkFileName: z.string().optional(),
  _standardDesignName: z.string().optional(),
})

const garmentLineSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  productType: z.string().min(1, 'Product type is required'),
  brand: z.string().min(1, 'Brand is required'),
  productName: z.string().min(1, 'Product name is required'),
  garmentColour: z.string().min(1, 'Garment colour is required'),
  quantity: z.coerce.number().min(24, 'Minimum order quantity is 24 per style'),
  decorations: z.array(decorationSchema).min(1).max(4, 'Maximum 4 decorations per garment'),
})

const customerDetailsSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Please enter a valid email address'),
  schoolName: z.string().min(1, 'School name is required'),
  phoneNumber: z.string().optional().or(z.literal('')),
  teacherName: z.string().min(1, 'Teacher in charge is required'),
  teacherEmail: z.string().email('Please enter a valid email address'),
  requiredOrderDate: z.string().min(1, 'Required order date is required'),
  orderingMethod: z.enum(['spreadsheet', 'online_store']),
})

// ─── Types ───────────────────────────────────────────────────────

export interface Decoration {
  decorationType: string
  detail: string
  location: string
  decorationColours: string
  artworkType: 'custom' | 'standard'
  artworkFileId: string
  standardDesignId: string
  _artworkFileName?: string
  _standardDesignName?: string
}

export interface GarmentLine {
  productId: string
  productType: string
  brand: string
  productName: string
  garmentColour: string
  quantity: number
  decorations: Decoration[]
  _expanded: boolean
}

export interface CustomerDetails {
  fullName: string
  email: string
  schoolName: string
  phoneNumber: string
  teacherName: string
  teacherEmail: string
  requiredOrderDate: string
  orderingMethod: 'spreadsheet' | 'online_store'
}

export interface CatalogData {
  products: any[]
  productTypes: any[]
  markupTiers: any[]
  decorationTypes: any[]
  decorationPricingTiers: any[]
  decorationLocations: any[]
  standardDesigns: any[]
}

export interface PricingResult {
  lines: any[]
  totalExclGst: number
  totalInclGst: number
  totalUnits: number
}

// ─── State ───────────────────────────────────────────────────────

interface State {
  step: 'builder' | 'details' | 'submitting' | 'success'
  loading: boolean
  error: string | null
  catalog: CatalogData
  garmentLines: GarmentLine[]
  customerDetails: CustomerDetails
  pricing: PricingResult | null
  pricingLoading: boolean
  quoteSessionId: string
  quoteNumber: string
  quoteId: string
  designPickerOpen: boolean
  designPickerTarget: { lineIdx: number; decoIdx: number } | null
}

type Action =
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_CATALOG'; catalog: CatalogData }
  | { type: 'SET_STEP'; step: State['step'] }
  | { type: 'SET_GARMENT_LINES'; garmentLines: GarmentLine[] }
  | { type: 'UPDATE_LINE'; lineIdx: number; line: GarmentLine }
  | { type: 'ADD_LINE' }
  | { type: 'REMOVE_LINE'; lineIdx: number }
  | { type: 'SET_CUSTOMER'; customerDetails: Partial<CustomerDetails> }
  | { type: 'SET_PRICING'; pricing: PricingResult | null }
  | { type: 'SET_PRICING_LOADING'; loading: boolean }
  | { type: 'SET_QUOTE_RESULT'; quoteNumber: string; quoteId: string }
  | { type: 'OPEN_DESIGN_PICKER'; lineIdx: number; decoIdx: number }
  | { type: 'CLOSE_DESIGN_PICKER' }

function emptyDecoration(): Decoration {
  return {
    decorationType: '', detail: '', location: '', decorationColours: '',
    artworkType: 'custom', artworkFileId: '', standardDesignId: '',
  }
}

function emptyGarmentLine(): GarmentLine {
  return {
    productId: '', productType: '', brand: '', productName: '',
    garmentColour: '', quantity: 24,
    decorations: [emptyDecoration()],
    _expanded: true,
  }
}

const initialState: State = {
  step: 'builder',
  loading: true,
  error: null,
  catalog: { products: [], productTypes: [], markupTiers: [], decorationTypes: [], decorationPricingTiers: [], decorationLocations: [], standardDesigns: [] },
  garmentLines: [emptyGarmentLine()],
  customerDetails: {
    fullName: '', email: '', schoolName: '', phoneNumber: '',
    teacherName: '', teacherEmail: '', requiredOrderDate: '', orderingMethod: 'spreadsheet',
  },
  pricing: null,
  pricingLoading: false,
  quoteSessionId: '',
  quoteNumber: '',
  quoteId: '',
  designPickerOpen: false,
  designPickerTarget: null,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_LOADING': return { ...state, loading: action.loading }
    case 'SET_ERROR': return { ...state, error: action.error }
    case 'SET_CATALOG': return { ...state, catalog: action.catalog, loading: false }
    case 'SET_STEP': return { ...state, step: action.step, error: null }
    case 'SET_GARMENT_LINES': return { ...state, garmentLines: action.garmentLines }
    case 'UPDATE_LINE': {
      const lines = [...state.garmentLines]
      lines[action.lineIdx] = action.line
      return { ...state, garmentLines: lines }
    }
    case 'ADD_LINE': return { ...state, garmentLines: [...state.garmentLines, emptyGarmentLine()] }
    case 'REMOVE_LINE': return { ...state, garmentLines: state.garmentLines.filter((_, i) => i !== action.lineIdx) }
    case 'SET_CUSTOMER': return { ...state, customerDetails: { ...state.customerDetails, ...action.customerDetails } }
    case 'SET_PRICING': return { ...state, pricing: action.pricing, pricingLoading: false }
    case 'SET_PRICING_LOADING': return { ...state, pricingLoading: action.loading }
    case 'SET_QUOTE_RESULT': return { ...state, quoteNumber: action.quoteNumber, quoteId: action.quoteId, step: 'success' }
    case 'OPEN_DESIGN_PICKER': return { ...state, designPickerOpen: true, designPickerTarget: { lineIdx: action.lineIdx, decoIdx: action.decoIdx } }
    case 'CLOSE_DESIGN_PICKER': return { ...state, designPickerOpen: false, designPickerTarget: null }
    default: return state
  }
}

// ─── Component ───────────────────────────────────────────────────

export function QuoteBuilder() {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    quoteSessionId: typeof crypto !== 'undefined' ? crypto.randomUUID() : '',
  })

  const pricingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load catalog data
  useEffect(() => {
    async function loadCatalog() {
      try {
        const [prodRes, decoRes, designRes] = await Promise.all([
          fetch(`${API_BASE}/products`).then(r => r.json()),
          fetch(`${API_BASE}/decorations`).then(r => r.json()),
          fetch(`${API_BASE}/designs`).then(r => r.json()),
        ])
        dispatch({
          type: 'SET_CATALOG',
          catalog: {
            products: prodRes.products || [],
            productTypes: prodRes.productTypes || [],
            markupTiers: prodRes.markupTiers || [],
            decorationTypes: decoRes.types || [],
            decorationPricingTiers: decoRes.pricingTiers || [],
            decorationLocations: decoRes.locations || [],
            standardDesigns: designRes.designs || [],
          },
        })
      } catch {
        dispatch({ type: 'SET_ERROR', error: 'Failed to load product data. Please refresh and try again.' })
        dispatch({ type: 'SET_LOADING', loading: false })
      }
    }
    loadCatalog()
  }, [])

  // Debounced pricing
  const fetchPricing = useCallback(async (lines: GarmentLine[]) => {
    const hasData = lines.some(l =>
      l.productId && l.quantity >= 24 && l.decorations.some(d => d.decorationType && d.detail)
    )
    if (!hasData) {
      dispatch({ type: 'SET_PRICING', pricing: null })
      return
    }

    dispatch({ type: 'SET_PRICING_LOADING', loading: true })
    try {
      const res = await fetch(`${API_BASE}/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          garmentLines: lines.map(l => ({
            productId: l.productId, productType: l.productType,
            brand: l.brand, productName: l.productName,
            quantity: l.quantity,
            decorations: l.decorations.filter(d => d.decorationType && d.detail).map(d => ({
              decorationType: d.decorationType, detail: d.detail, location: d.location,
              artworkType: d.artworkType, artworkFileId: d.artworkFileId || undefined,
              standardDesignId: d.standardDesignId || undefined,
            })),
          })),
        }),
      })
      if (res.ok) {
        dispatch({ type: 'SET_PRICING', pricing: await res.json() })
      }
    } catch {
      dispatch({ type: 'SET_PRICING_LOADING', loading: false })
    }
  }, [])

  const debouncePricing = useCallback((lines: GarmentLine[]) => {
    if (pricingTimerRef.current) clearTimeout(pricingTimerRef.current)
    pricingTimerRef.current = setTimeout(() => fetchPricing(lines), 500)
  }, [fetchPricing])

  // Handlers
  const handleLineChange = useCallback((lineIdx: number, line: GarmentLine) => {
    dispatch({ type: 'UPDATE_LINE', lineIdx, line })
    // We need to compute the full lines array for pricing
    const updated = state.garmentLines.map((l, i) => i === lineIdx ? line : l)
    debouncePricing(updated)
  }, [state.garmentLines, debouncePricing])

  const handleAddLine = useCallback(() => dispatch({ type: 'ADD_LINE' }), [])
  const handleRemoveLine = useCallback((idx: number) => {
    dispatch({ type: 'REMOVE_LINE', lineIdx: idx })
    const updated = state.garmentLines.filter((_, i) => i !== idx)
    debouncePricing(updated)
  }, [state.garmentLines, debouncePricing])

  const handleGoToDetails = useCallback(() => {
    // Validate all lines with Zod
    const errors: string[] = []
    for (let i = 0; i < state.garmentLines.length; i++) {
      const result = garmentLineSchema.safeParse(state.garmentLines[i])
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push(`Line ${i + 1}: ${issue.message}`)
        }
      }
    }
    if (errors.length > 0) {
      dispatch({ type: 'SET_ERROR', error: errors.join('. ') })
      return
    }
    dispatch({ type: 'SET_STEP', step: 'details' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [state.garmentLines])

  const handleSubmit = useCallback(async () => {
    const result = customerDetailsSchema.safeParse(state.customerDetails)
    if (!result.success) {
      const msgs = result.error.issues.map(i => i.message)
      dispatch({ type: 'SET_ERROR', error: msgs.join('. ') })
      return
    }
    // Online store min units check
    if (state.customerDetails.orderingMethod === 'online_store') {
      const total = state.garmentLines.reduce((s, l) => s + l.quantity, 0)
      if (total < 50) {
        dispatch({ type: 'SET_ERROR', error: 'Online store ordering requires a minimum of 50 total units.' })
        return
      }
    }

    dispatch({ type: 'SET_STEP', step: 'submitting' })

    try {
      const res = await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerDetails: state.customerDetails,
          garmentLines: state.garmentLines.map(l => ({
            productId: l.productId, productType: l.productType,
            brand: l.brand, productName: l.productName, quantity: l.quantity,
            decorations: l.decorations.filter(d => d.decorationType && d.detail).map(d => ({
              decorationType: d.decorationType, detail: d.detail, location: d.location,
              artworkType: d.artworkType, artworkFileId: d.artworkFileId || undefined,
              standardDesignId: d.standardDesignId || undefined,
            })),
          })),
          gstMode: 'incl' as const,
          quoteSessionId: state.quoteSessionId,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        dispatch({ type: 'SET_QUOTE_RESULT', quoteNumber: data.quoteNumber, quoteId: data.quoteId })
      } else {
        dispatch({ type: 'SET_ERROR', error: data.error || 'Failed to submit quote.' })
        dispatch({ type: 'SET_STEP', step: 'details' })
      }
    } catch {
      dispatch({ type: 'SET_ERROR', error: 'Network error. Please try again.' })
      dispatch({ type: 'SET_STEP', step: 'details' })
    }
  }, [state.customerDetails, state.garmentLines, state.quoteSessionId])

  // ─── Render ────────────────────────────────────────────────────

  if (state.loading) {
    return <div className="text-center py-20 text-muted-foreground">Loading quote builder...</div>
  }

  return (
    <div>
      {state.error && (
        <div className="glass-error-box px-4 py-3 mb-4 text-sm text-red-800">{state.error}</div>
      )}

      {/* Builder step */}
      {state.step === 'builder' && (
        <>
          <GarmentLinesForm
            lines={state.garmentLines}
            catalog={state.catalog}
            pricing={state.pricing}
            onLineChange={handleLineChange}
            onAddLine={handleAddLine}
            onRemoveLine={handleRemoveLine}
            onOpenDesignPicker={(lineIdx, decoIdx) => dispatch({ type: 'OPEN_DESIGN_PICKER', lineIdx, decoIdx })}
            quoteSessionId={state.quoteSessionId}
            artworkUploadUrl={ARTWORK_UPLOAD_URL}
          />

          {state.pricing && state.pricing.totalInclGst > 0 && (
            <SummaryPanel
              pricing={state.pricing}
              garmentLines={state.garmentLines}
            />
          )}

          <div className="flex justify-end mt-6">
            <button className="btn-accent py-3 px-8 text-lg italic" onClick={handleGoToDetails}>
              Continue to details&nbsp;&rarr;
            </button>
          </div>
        </>
      )}

      {/* Details step */}
      {(state.step === 'details' || state.step === 'submitting') && (
        <CustomerDetailsModal
          customerDetails={state.customerDetails}
          onChange={(d) => dispatch({ type: 'SET_CUSTOMER', customerDetails: d })}
          onBack={() => dispatch({ type: 'SET_STEP', step: 'builder' })}
          onSubmit={handleSubmit}
          submitting={state.step === 'submitting'}
          totalUnits={state.garmentLines.reduce((s, l) => s + l.quantity, 0)}
        />
      )}

      {/* Success */}
      {state.step === 'success' && (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-5 bg-emerald-50 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">Quote request submitted!</h2>
          <div className="glass-badge-blue inline-block px-6 py-3 text-lg font-bold mb-4">
            #{state.quoteNumber}
          </div>
          <p className="text-muted-foreground max-w-md mx-auto">
            Thanks for your leavers gear quote request! We&rsquo;ve received it and will be in touch shortly.
            A confirmation email has been sent to <strong>{state.customerDetails.email}</strong>.
          </p>
        </div>
      )}

      {/* Design Picker Modal */}
      {state.designPickerOpen && (
        <div className="glass-modal-backdrop" onClick={() => dispatch({ type: 'CLOSE_DESIGN_PICKER' })}>
          <div className="glass-modal-content max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Choose a Standard Design</h3>
              <button className="btn-ghost" onClick={() => dispatch({ type: 'CLOSE_DESIGN_PICKER' })}>Close</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {state.catalog.standardDesigns.map((design: any) => (
                <button
                  key={design.id}
                  className="card-interactive p-3 text-center"
                  onClick={() => {
                    if (state.designPickerTarget) {
                      const { lineIdx, decoIdx } = state.designPickerTarget
                      const line = { ...state.garmentLines[lineIdx] }
                      const decos = [...line.decorations]
                      decos[decoIdx] = {
                        ...decos[decoIdx],
                        artworkType: 'standard',
                        standardDesignId: design.id,
                        _standardDesignName: design.name,
                      }
                      line.decorations = decos
                      dispatch({ type: 'UPDATE_LINE', lineIdx, line })
                    }
                    dispatch({ type: 'CLOSE_DESIGN_PICKER' })
                  }}
                >
                  {design.imageUrl ? (
                    <img src={design.imageUrl} alt={design.name} className="w-full h-20 object-contain rounded-lg" />
                  ) : (
                    <div className="w-full h-20 bg-gray-50 rounded-lg flex items-center justify-center text-muted-foreground text-xs">Preview</div>
                  )}
                  <div className="text-sm font-medium mt-2">{design.name}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
