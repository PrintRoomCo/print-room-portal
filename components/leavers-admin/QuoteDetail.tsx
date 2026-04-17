'use client'

import { StatusBadge } from './StatusBadge'

interface Props {
  quote: any
}

export function QuoteDetail({ quote }: Props) {
  const details = quote.leavers_quote_details?.[0]
  const garmentLines = details?.garment_lines || quote.line_items || []
  const pricingSnapshot = details?.pricing_snapshot || {}

  const formatPrice = (n: number | null | undefined) => n != null ? `$${Number(n).toFixed(2)}` : '--'

  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="card p-6">
        <h3 className="font-semibold mb-4">Overview</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground block text-xs uppercase tracking-wide mb-1">Customer</span>
            <span className="font-medium">{quote.customer_name}</span>
            <div className="text-muted-foreground">{quote.customer_email}</div>
            {quote.customer_phone && <div className="text-muted-foreground">{quote.customer_phone}</div>}
          </div>
          <div>
            <span className="text-muted-foreground block text-xs uppercase tracking-wide mb-1">School</span>
            <span className="font-medium">{details?.school_name || quote.customer_company || '--'}</span>
            {details?.teacher_name && <div className="text-muted-foreground">Teacher: {details.teacher_name}</div>}
            {details?.teacher_email && <div className="text-muted-foreground">{details.teacher_email}</div>}
          </div>
          <div>
            <span className="text-muted-foreground block text-xs uppercase tracking-wide mb-1">Details</span>
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={quote.status} />
            </div>
            <div className="text-muted-foreground">
              Method: {details?.ordering_method === 'online_store' ? 'Online Store' : 'Spreadsheet'}
            </div>
            {details?.required_order_date && (
              <div className="text-muted-foreground">Required: {details.required_order_date}</div>
            )}
            {quote.monday_item_id && (
              <a
                href={`https://theprint-room.monday.com/boards/${quote.monday_board_id}/pulses/${quote.monday_item_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[rgb(var(--color-brand-blue))] text-xs underline mt-1 inline-block"
              >
                View on Monday.com &rarr;
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Garment lines */}
      <div className="card p-6">
        <h3 className="font-semibold mb-4">Garment Lines</h3>
        {garmentLines.length === 0 ? (
          <p className="text-muted-foreground text-sm">No garment lines recorded.</p>
        ) : (
          <div className="space-y-3">
            {garmentLines.map((line: any, idx: number) => (
              <div key={idx} className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">
                    {line.productName || line.productType || `Line ${idx + 1}`}
                    {line.brand && <span className="text-muted-foreground font-normal"> — {line.brand}</span>}
                  </span>
                  <span className="glass-badge-blue">x{line.quantity}</span>
                </div>
                {line.garmentColour && (
                  <div className="text-xs text-muted-foreground mb-2">Colour: {line.garmentColour}</div>
                )}
                {line.decorations?.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {line.decorations.map((deco: any, dIdx: number) => (
                      <div key={dIdx} className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className="glass-badge-gray">{deco.decorationType}</span>
                        <span>{deco.detail}</span>
                        {deco.location && <span>@ {deco.location}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pricing */}
      <div className="card-elevated p-6 border-2 border-[rgb(var(--color-brand-blue))]">
        <h3 className="font-semibold text-[rgb(var(--color-brand-blue))] mb-4">Pricing Snapshot</h3>
        {pricingSnapshot.lines ? (
          <>
            {pricingSnapshot.lines.filter((l: any) => l.priceable).map((line: any) => (
              <div key={line.garmentLineIndex} className="flex justify-between py-2 border-b border-gray-100 text-sm">
                <span>
                  {garmentLines[line.garmentLineIndex]?.productName || `Line ${line.garmentLineIndex + 1}`}
                  <span className="text-muted-foreground ml-2">
                    {formatPrice(line.unitPriceInclGst)}/unit &times; {garmentLines[line.garmentLineIndex]?.quantity || 0}
                  </span>
                </span>
                <span className="font-medium">{formatPrice(line.lineSubtotalInclGst)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-3 mt-2 border-t-2 border-[rgb(var(--color-brand-blue))]">
              <span className="font-bold">Total (incl. GST)</span>
              <span className="font-bold text-lg">{formatPrice(pricingSnapshot.totalInclGst)}</span>
            </div>
            <div className="text-xs text-muted-foreground text-right mt-1">
              {pricingSnapshot.totalUnits} units · Excl. GST: {formatPrice(pricingSnapshot.totalExclGst)}
            </div>
          </>
        ) : (
          <div className="flex justify-between text-lg">
            <span className="font-bold">Total</span>
            <span className="font-bold">{formatPrice(quote.total_amount)}</span>
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="text-xs text-muted-foreground">
        Created: {new Date(quote.created_at).toLocaleString('en-NZ')}
        {quote.submitted_at && ` · Submitted: ${new Date(quote.submitted_at).toLocaleString('en-NZ')}`}
      </div>
    </div>
  )
}
