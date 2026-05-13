import type { CSSProperties, ReactNode } from 'react'
import {
  calculateLineTotal,
  SIZE_COLUMNS,
  type ProofDesign,
  type ProofDocument,
  type ProofOrderLine,
  type ProofPrintArea,
} from '@/lib/proofs/types'

interface ProofViewerProps {
  document: ProofDocument
  proofName: string
}

const NAVY = '#25358b'
const ARTWORK_PAPER = '#f0eddf'
const PAGE_W = 841.89
const PAGE_H = 595.28
const ORDER_FIRST_PAGE_ROWS = 4
const ORDER_CONTINUATION_ROWS = 10

const monoFont: CSSProperties = { fontFamily: '"Courier New", Courier, monospace' }
const titleFont: CSSProperties = { fontFamily: '"Arial Black", Impact, sans-serif' }

/**
 * Read-only proof renderer for the customer portal.
 *
 * Mirrors `print-room-staff-portal/src/components/proofs/proof-preview.tsx`
 * so the customer browser proof matches the staff preview and PDF export.
 */
export function ProofViewer({ document, proofName }: ProofViewerProps) {
  const orderChunks = chunkOrderLines(document.orderLines)
  const pages = [
    ...orderChunks.map((lines, index) => ({
      key: `order-${index}`,
      label: index === 0 ? 'Order approval' : `Order details ${index + 1}`,
      node: (
        <OrderApprovalPage
          document={document}
          lines={lines}
          pageIndex={index}
          totalOrderPages={orderChunks.length}
        />
      ),
    })),
    ...document.designs.flatMap((design) => [
      {
        key: `proof-${design.id}`,
        label: `Final proof ${design.index}`,
        node: <FinalProofPage document={document} design={design} />,
      },
      {
        key: `artwork-${design.id}`,
        label: `Artwork ${design.index}`,
        node: <ArtworkPage document={document} design={design} />,
      },
    ]),
  ]

  return (
    <div className="space-y-6">
      {pages.map((page, index) => (
        <div key={page.key} className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="border border-gray-300 px-2 py-0.5 font-medium text-gray-900">Page {index + 1}</span>
              <span className="border border-gray-300 px-2 py-0.5 text-gray-700">{page.label}</span>
            </div>
            <span className="text-xs text-gray-500">{proofName}</span>
          </div>

          <div className="overflow-hidden border border-gray-300 bg-white">
            <div className="aspect-[297/210] bg-white">{page.node}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function OrderApprovalPage({
  document,
  lines,
  pageIndex,
  totalOrderPages,
}: {
  document: ProofDocument
  lines: ProofOrderLine[]
  pageIndex: number
  totalOrderPages: number
}) {
  const tableTop = pageIndex === 0 ? 328 : 20
  const tableHeight = (pageIndex === 0 ? 48 : 0) + Math.max(lines.length, 1) * 54
  const notesTop = Math.min(tableTop + tableHeight + 20, 520)

  return (
    <div className="relative h-full bg-white text-black" style={monoFont}>
      {pageIndex === 0 && (
        <>
          <ContactTable document={document} />
          <TermsPanel terms={document.terms} />
          <ApprovalPanel document={document} />
          {document.warning && (
            <div style={rect(32, 263, 778, 32)} className="text-[10px] leading-[1.55] text-[#e11d25]">
              {document.warning}
            </div>
          )}
          <div style={rect(32, 304, 240, 18)} className="text-[13px] font-bold">
            Garment/order details
          </div>
        </>
      )}

      <OrderTable
        lines={lines}
        showHeader={pageIndex === 0}
        style={rect(32, tableTop, 778, tableHeight)}
      />

      {pageIndex === totalOrderPages - 1 && (
        <div style={rect(32, notesTop, 778, 44)} className="text-[13px] leading-5">
          <p>Additional job notes:</p>
          {document.notes && <p className="mt-2 text-[8px] leading-4">{document.notes}</p>}
        </div>
      )}
    </div>
  )
}

function FinalProofPage({ document, design }: { document: ProofDocument; design: ProofDesign }) {
  return (
    <div className="relative h-full bg-white" style={monoFont}>
      <ProofHeader kind="FINAL PROOF" document={document} design={design} showSubtitle />
      <div style={rect(54, 110, 90, 16)} className="text-[10px] font-bold uppercase text-[#25358b]">
        FRONT:
      </div>
      <div style={rect(350, 110, 90, 16)} className="text-[10px] font-bold uppercase text-[#25358b]">
        BACK:
      </div>

      <ImageSlot imageUrl={design.frontMockupUrl} alt={`${design.name} front mockup`} style={rect(54, 146, 280, 255)} />
      <ImageSlot imageUrl={design.backMockupUrl} alt={`${design.name} back mockup`} style={rect(350, 146, 280, 255)} />

      <PrintHeightsColumn design={design} />
      <FinalSpecBand design={design} />
    </div>
  )
}

function ArtworkPage({ document, design }: { document: ProofDocument; design: ProofDesign }) {
  return (
    <div className="relative h-full bg-white" style={monoFont}>
      <ProofHeader kind="ARTWORK" document={document} design={design} />
      <div
        style={{ ...rect(32, 100, 778, 384), backgroundColor: design.artworkBackground || ARTWORK_PAPER }}
        className="flex items-center justify-center overflow-hidden"
      >
        {design.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={design.artworkUrl} alt={`${design.name} artwork`} className="max-h-[82%] max-w-[82%] object-contain" />
        ) : (
          <div className="px-8 text-center text-5xl text-[#2f281f]">{design.name}</div>
        )}
      </div>
      <ArtworkFooter document={document} />
    </div>
  )
}

function ContactTable({ document }: { document: ProofDocument }) {
  return (
    <div style={rect(32, 21, 778, 59)} className="grid grid-cols-2 border-[1.5px] border-black text-[10px] leading-[1.35]">
      <KeyValueRows
        className="border-r-[1.5px] border-black px-2 py-2"
        rows={[
          ['Prepared by:', document.preparedByName || document.preparedByEmail],
          ['Phone:', document.preparedByPhone],
          ['Email:', document.preparedByEmail],
          ['Website:', document.website],
        ]}
      />
      <KeyValueRows
        className="px-2 py-2"
        rows={[
          ['Customer:', document.customerName],
          ['Job name:', document.jobName],
          ['Job Reference:', document.jobReference],
        ]}
      />
    </div>
  )
}

function KeyValueRows({ rows, className }: { rows: Array<[string, string]>; className?: string }) {
  return (
    <div className={className}>
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[120px_1fr]">
          <span>{label}</span>
          <span>{value || '-'}</span>
        </div>
      ))}
    </div>
  )
}

function TermsPanel({ terms }: { terms: string }) {
  return (
    <div style={rect(32, 94, 778, 66)} className="border-[1.5px] border-black">
      <div className="h-[23px] bg-[#1458c8] px-2 pt-[6px] text-[10px] text-white">TERMS & CONDITIONS</div>
      <div className="px-2 py-2 text-[8px] leading-[1.35]">{terms || '-'}</div>
    </div>
  )
}

function ApprovalPanel({ document }: { document: ProofDocument }) {
  return (
    <div style={rect(32, 168, 778, 92)} className="border-[1.5px] border-black text-[10px]">
      <div className="grid h-[23px] grid-cols-2 bg-[#1458c8] text-white">
        <div className="border-r-[1.5px] border-black px-2 pt-[6px]">CUSTOMER APPROVAL</div>
        <div />
      </div>
      <div className="grid h-[42px] grid-cols-2 border-t-[1.5px] border-black">
        <div className="border-r-[1.5px] border-black px-2 py-2">
          <p className="text-[13px]">Delivery date with customer: {document.deliveryDateLabel}</p>
          <p className="mt-1">{document.approvalCopy || 'Subject to approval within 1 working day of receiving this proof.'}</p>
        </div>
        <div />
      </div>
      <div className="grid h-[27px] grid-cols-2 border-t-[1.5px] border-black text-[14px]">
        <div className="border-r-[1.5px] border-black px-2 pt-2">Signature: ____________________________</div>
        <div className="px-2 pt-2">Name: ____________________________</div>
      </div>
    </div>
  )
}

function ProofHeader({
  kind,
  document,
  design,
  showSubtitle = false,
}: {
  kind: 'FINAL PROOF' | 'ARTWORK'
  document: ProofDocument
  design: ProofDesign
  showSubtitle?: boolean
}) {
  return (
    <>
      <div
        style={{ ...rect(54, 39, 540, 60), ...titleFont, color: NAVY, fontSize: 'clamp(24px, 4.2vw, 48px)' }}
        className="whitespace-nowrap font-black uppercase leading-none"
      >
        {kind} - DESIGN {design.index}
      </div>
      {showSubtitle && (
        <div
          style={{ ...rect(360, 80, 196, 18), color: NAVY }}
          className="truncate text-right text-[15px] font-black uppercase leading-none"
        >
          {design.subtitle || design.name}
        </div>
      )}
      <div style={{ ...rect(560, 20, 250, 78), backgroundColor: NAVY }} className="px-6 pt-6 text-[10px] text-white">
        <span className="font-bold">Client:</span>
        <span className="ml-8 font-bold">{clientLabel(document.customerName)}</span>
      </div>
      <div style={rect(32, 98, 528, 2)} className="bg-[#25358b]" />
    </>
  )
}

function PrintHeightsColumn({ design }: { design: ProofDesign }) {
  return (
    <div style={rect(650, 108, 150, 444)} className="border-l-2 border-[#25358b] pl-3 text-[#25358b]">
      <p className="mt-1 text-[10px] font-bold">PRINT HEIGHTS:</p>
      <p className="text-[7px] leading-tight">{design.printHeightsNote || 'IF GARMENTS DIFFER'}</p>
    </div>
  )
}

function FinalSpecBand({ design }: { design: ProofDesign }) {
  const areas = design.printAreas.length > 0 ? design.printAreas : []
  return (
    <>
      <div style={rect(40, 438, 740, 2)} className="bg-[#25358b]" />
      <div style={rect(40, 446, 598, 106)} className="flex text-[#25358b]">
        {areas.length === 0 ? (
          <div className="p-2 text-[9px] font-bold">PRINT AREAS: <span className="font-normal text-black">No print areas supplied.</span></div>
        ) : (
          areas.map((area, index) => (
            <PrintAreaSpec
              key={area.id}
              area={area}
              index={index + 1}
              className={index > 0 ? 'border-l-2 border-[#25358b]' : undefined}
            />
          ))
        )}
      </div>
      <div style={rect(662, 451, 132, 100)} className="text-[9px] font-bold text-[#25358b]">
        <p>PRODUCTION NOTE:</p>
        <p className="mt-2 text-[#e11d25]">{(design.productionNote || 'N/A').toUpperCase()}</p>
        <p className="mt-12 text-[8px]">IMPORTANT!!!</p>
        <p className="mt-1 text-[5px] leading-tight">PLEASE CHECK THAT YOUR ORDER HAS BEEN DELIVERED IN FULL. IF THERE IS AN ERROR, PLEASE CONTACT US WITHIN 7 DAYS.</p>
      </div>
    </>
  )
}

function PrintAreaSpec({ area, index, className }: { area: ProofPrintArea; index: number; className?: string }) {
  return (
    <div className={`flex-1 px-3 text-[9px] font-bold leading-[1.45] ${className || ''}`}>
      <p>PRINT AREA {index}: <span className="ml-3">{area.label.toUpperCase()}</span></p>
      <p>
        METHOD:
        <span className="ml-3 rounded-sm bg-[#1599d5] px-1.5 py-0.5 text-[7px] text-white">{methodLabel(area.method)}</span>
      </p>
      <p>DIMENSIONS: <span className="font-normal">{area.widthMm || '-'}MM W X {area.heightMm || '-'}MM H</span></p>
      <p>COLOURS:</p>
      <p className="mt-2 flex items-center gap-3 font-normal">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: area.pantoneHex || '#2f2118' }} />
        <span>-PANTONE {(area.pantone || '-').toUpperCase()}</span>
      </p>
      <p className="mt-8">ARTWORK:<span className="text-[#e11d25]">{(area.artworkStatus || 'NEW').toUpperCase()}</span></p>
    </div>
  )
}

function ArtworkFooter({ document }: { document: ProofDocument }) {
  return (
    <div style={{ ...rect(32, 484, 778, 74), backgroundColor: NAVY }} className="flex items-center text-white">
      <div className="w-[180px] pl-6 text-[10px] font-bold leading-[1.6]">
        <p>{document.preparedByPhone}</p>
        <p>{document.preparedByEmail}</p>
        <p>{document.website}</p>
      </div>
      <div className="h-10 border-l border-white" />
      <div className="flex-1 px-5 text-[6px] leading-[1.35]">{document.terms}</div>
      <div className="mr-7 flex h-12 w-16 items-center justify-center rounded-lg border-2 border-white text-center text-[17px] font-black leading-none">
        PRINT<br />ROOM
      </div>
    </div>
  )
}

function OrderTable({
  lines,
  showHeader,
  style,
}: {
  lines: ProofOrderLine[]
  showHeader: boolean
  style: CSSProperties
}) {
  const columns = orderColumns()
  const tableHeight = (showHeader ? 48 : 0) + Math.max(lines.length, 1) * 54
  return (
    <table className="border-collapse table-fixed text-[8px] leading-[1.45]" style={{ ...style, height: pct(tableHeight, PAGE_H) }}>
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={{ width: `${(column.width / 778) * 100}%` }} />
        ))}
      </colgroup>
      {showHeader && (
        <thead>
          <tr style={{ height: `${(48 / tableHeight) * 100}%` }}>
            {columns.map((column) => (
              <th key={column.key} className="whitespace-pre-line border-[1.5px] border-black px-1.5 py-2 text-left align-top font-bold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {lines.length === 0 ? (
          <tr style={{ height: `${(54 / tableHeight) * 100}%` }}>
            <td className="border-[1.5px] border-black px-2 py-5 text-center" colSpan={columns.length}>
              No order lines
            </td>
          </tr>
        ) : (
          lines.map((line) => (
            <tr key={line.id} style={{ height: `${(54 / tableHeight) * 100}%` }}>
              {columns.map((column) => (
                <td key={column.key} className={`border-[1.5px] border-black px-1.5 py-2 align-top ${column.center ? 'text-center' : ''}`}>
                  {orderCellValue(line, column.key)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function ImageSlot({ imageUrl, alt, style }: { imageUrl: string; alt: string; style: CSSProperties }) {
  return (
    <div style={style} className="flex items-center justify-center overflow-hidden">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={alt} className="max-h-full max-w-full object-contain" />
      ) : (
        <div className="text-center text-xs text-gray-400">{alt}</div>
      )}
    </div>
  )
}

function orderColumns() {
  return [
    { key: 'name', label: 'Name', width: 64 },
    { key: 'brand', label: 'Brand', width: 54 },
    { key: 'garment', label: 'Garment', width: 79 },
    { key: 'sku', label: 'SKU', width: 50 },
    { key: 'colour', label: 'Colour', width: 44 },
    ...SIZE_COLUMNS.map((label) => ({ key: label, label: formatSizeColumn(label), width: 34.7, center: true })),
    { key: 'total', label: 'Total', width: 35.9, center: true },
  ]
}

function orderCellValue(line: ProofOrderLine, key: string): ReactNode {
  if (key === 'name') return line.name || `Design ${line.designIndex}`
  if (key === 'brand') return line.brand || ''
  if (key === 'garment') return line.garment || ''
  if (key === 'sku') return line.sku || ''
  if (key === 'colour') return line.colour || ''
  if (key === 'total') return calculateLineTotal(line)
  return line.quantities[key] || ''
}

function chunkOrderLines(items: ProofOrderLine[]) {
  if (items.length === 0) return [[] as ProofOrderLine[]]
  const chunks: ProofOrderLine[][] = [items.slice(0, ORDER_FIRST_PAGE_ROWS)]
  for (let index = ORDER_FIRST_PAGE_ROWS; index < items.length; index += ORDER_CONTINUATION_ROWS) {
    chunks.push(items.slice(index, index + ORDER_CONTINUATION_ROWS))
  }
  return chunks
}

function rect(x: number, y: number, width: number, height: number): CSSProperties {
  return {
    position: 'absolute',
    left: pct(x, PAGE_W),
    top: pct(y, PAGE_H),
    width: pct(width, PAGE_W),
    height: pct(height, PAGE_H),
  }
}

function pct(value: number, total: number) {
  return `${(value / total) * 100}%`
}

function formatSizeColumn(label: string) {
  if (label === 'One Size') return 'One\nSize'
  return label.replace('/', ' /\n')
}

function methodLabel(method: string) {
  return method.replace('_', ' ').toUpperCase()
}

function clientLabel(customerName: string) {
  const firstWord = customerName.trim().split(/\s+/)[0]
  return (firstWord || customerName || 'CLIENT').toUpperCase()
}
