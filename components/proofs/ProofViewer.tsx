import type { ReactNode } from 'react'
import {
  calculateLineTotal,
  SIZE_COLUMNS,
  type ProofDesign,
  type ProofDocument,
  type ProofOrderLine,
} from '@/lib/proofs/types'

interface ProofViewerProps {
  document: ProofDocument
  proofName: string
}

const NAVY = '#23336f'
const BLUE = '#2a3d91'
const PAGE_BG = '#f8f8f4'

/**
 * Read-only proof renderer for the customer portal.
 *
 * Mirrors `print-room-staff-portal/src/components/proofs/proof-preview.tsx`
 * but drops Card/Badge primitives (not present in this repo) for plain Tailwind.
 * No editing affordances — Slice G adds the "Edit proof" entry-point.
 */
export function ProofViewer({ document, proofName }: ProofViewerProps) {
  const orderChunks = chunkArray(document.orderLines, 10)
  const pages = [
    ...orderChunks.map((lines, index) => ({
      key: `order-${index}`,
      label: index === 0 ? 'Order approval' : `Order details ${index + 1}`,
      node: (
        <OrderApprovalPage
          document={document}
          lines={lines}
          pageIndex={index}
          totalOrderPages={Math.max(orderChunks.length, 1)}
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
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900">
                Page {index + 1}
              </span>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                {page.label}
              </span>
            </div>
            <span className="text-xs text-gray-500">{proofName}</span>
          </div>

          <div className="overflow-hidden rounded-[18px] border border-gray-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
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
  return (
    <div className="flex h-full flex-col bg-white p-[3.5%] text-[#111827]">
      <div className="grid grid-cols-[1fr_1fr] gap-4 text-[10px] leading-4">
        <MetaTable
          title="Prepared by"
          rows={[
            ['Name', document.preparedByName],
            ['Phone', document.preparedByPhone],
            ['Email', document.preparedByEmail],
            ['Website', document.website],
          ]}
        />
        <MetaTable
          title="Customer"
          rows={[
            ['Customer', document.customerName],
            ['Email', document.customerEmail],
            ['Job name', document.jobName],
            ['Job reference', document.jobReference],
          ]}
        />
      </div>

      {pageIndex === 0 && (
        <div className="mt-4 grid grid-cols-[1.15fr_0.85fr] gap-4 text-[10px] leading-4">
          <InfoBlock title="Terms & Conditions" body={document.terms} />
          <InfoBlock
            title="Customer Approval"
            body={document.approvalCopy}
            footer={
              <div className="mt-3 grid grid-cols-3 gap-3">
                <SignatureLine label="Delivery date" value={document.deliveryDateLabel} />
                <SignatureLine label="Signed by" value="" />
                <SignatureLine label="Date" value="" />
              </div>
            }
          />
        </div>
      )}

      {document.warning && pageIndex === 0 && (
        <div className="mt-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-[10px] leading-4 text-red-800">
          {document.warning}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em]" style={{ color: NAVY }}>
          Garment/order details
        </h2>
        {totalOrderPages > 1 && (
          <span className="text-[10px] text-gray-500">
            Sheet {pageIndex + 1} of {totalOrderPages}
          </span>
        )}
      </div>

      <div className="mt-2 overflow-hidden border border-gray-300">
        <OrderTable lines={lines} />
      </div>

      {pageIndex === totalOrderPages - 1 && (
        <div className="mt-auto pt-4 text-[10px] leading-4">
          <p className="font-semibold" style={{ color: NAVY }}>
            Additional job notes:
          </p>
          <p className="mt-1 min-h-8 whitespace-pre-wrap text-gray-700">{document.notes}</p>
        </div>
      )}
    </div>
  )
}

function FinalProofPage({ document, design }: { document: ProofDocument; design: ProofDesign }) {
  return (
    <div className="flex h-full flex-col bg-white p-[3.5%] text-[#111827]">
      <ProofPageHeader
        title={`FINAL PROOF - DESIGN ${design.index}`}
        client={document.customerName}
        job={document.jobName}
      />

      <div className="mt-4 grid flex-1 grid-cols-[1fr_1fr_0.48fr] gap-4">
        <MockupPanel label="Front" imageUrl={design.frontMockupUrl} designName={design.name} />
        <MockupPanel label="Back" imageUrl={design.backMockupUrl} designName={design.name} />
        <div className="border border-gray-300 bg-gray-50 p-3 text-[11px] leading-5">
          <p className="font-bold uppercase" style={{ color: NAVY }}>
            Print heights
          </p>
          <p className="mt-2 whitespace-pre-wrap">{design.printHeightsNote}</p>
          {design.productionNote && (
            <>
              <p className="mt-5 font-bold uppercase" style={{ color: NAVY }}>
                Production note
              </p>
              <p className="mt-2 whitespace-pre-wrap">{design.productionNote}</p>
            </>
          )}
        </div>
      </div>

      <div
        className="mt-4 grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(design.printAreas.length, 1)}, minmax(0, 1fr))` }}
      >
        {design.printAreas.map((area) => (
          <div key={area.id} className="border border-gray-300 bg-white text-[10px] leading-4">
            <div
              className="px-3 py-1.5 text-[11px] font-bold uppercase text-white"
              style={{ backgroundColor: NAVY }}
            >
              {area.label}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-3">
              <Spec label="Method" value={methodLabel(area.method)} />
              <Spec label="Dimensions" value={`${area.widthMm || '-'}mm x ${area.heightMm || '-'}mm`} />
              <Spec
                label="Colour"
                value={
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="h-3 w-3 border border-gray-300"
                      style={{ backgroundColor: area.pantoneHex }}
                    />
                    {area.pantone || '-'}
                  </span>
                }
              />
              <Spec label="Artwork" value={area.artworkStatus || 'NEW'} />
              <Spec label="Production note" value={area.productionNote || 'N/A'} wide />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ArtworkPage({ document, design }: { document: ProofDocument; design: ProofDesign }) {
  return (
    <div className="flex h-full flex-col bg-white p-[3.5%] text-[#111827]">
      <ProofPageHeader
        title={`ARTWORK - DESIGN ${design.index}`}
        client={document.customerName}
        job={document.jobName}
      />

      <div
        className="mt-4 flex flex-1 items-center justify-center overflow-hidden border border-gray-300"
        style={{ backgroundColor: design.artworkBackground || PAGE_BG }}
      >
        {design.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={design.artworkUrl}
            alt={`${design.name} artwork`}
            className="max-h-[78%] max-w-[78%] object-contain"
          />
        ) : (
          <div className="px-8 text-center text-white/80">
            <p className="text-4xl font-semibold">{design.name}</p>
            {design.artworkNotes && <p className="mt-3 text-sm">{design.artworkNotes}</p>}
          </div>
        )}
      </div>

      <div
        className="mt-4 flex items-center justify-between px-4 py-3 text-[10px] text-white"
        style={{ backgroundColor: NAVY }}
      >
        <span>{document.preparedByPhone}</span>
        <span>{document.preparedByEmail}</span>
        <span>{document.website}</span>
        <span className="text-sm font-bold tracking-[-0.02em]">Print Room</span>
      </div>
    </div>
  )
}

function ProofPageHeader({ title, client, job }: { title: string; client: string; job: string }) {
  return (
    <div className="grid grid-cols-[1fr_0.42fr] gap-4">
      <div className="px-4 py-3 text-white" style={{ backgroundColor: NAVY }}>
        <h1 className="text-xl font-bold tracking-[0.04em]">{title}</h1>
      </div>
      <div className="px-4 py-3 text-right text-white" style={{ backgroundColor: BLUE }}>
        <p className="text-xs uppercase tracking-[0.18em]">{client}</p>
        <p className="mt-1 text-sm font-semibold">{job}</p>
      </div>
    </div>
  )
}

function MetaTable({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="border border-gray-300">
      <div
        className="px-3 py-1.5 text-[10px] font-bold uppercase text-white"
        style={{ backgroundColor: NAVY }}
      >
        {title}
      </div>
      <div>
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[0.34fr_1fr] border-t border-gray-200">
            <span className="bg-gray-50 px-3 py-1.5 font-semibold">{label}</span>
            <span className="px-3 py-1.5">{value || '-'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function InfoBlock({ title, body, footer }: { title: string; body: string; footer?: ReactNode }) {
  return (
    <div className="border border-gray-300">
      <div
        className="px-3 py-1.5 text-[10px] font-bold uppercase text-white"
        style={{ backgroundColor: NAVY }}
      >
        {title}
      </div>
      <div className="p-3">
        <p>{body}</p>
        {footer}
      </div>
    </div>
  )
}

function SignatureLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <div className="mt-3 border-b border-gray-500 pb-1">{value}</div>
    </div>
  )
}

function OrderTable({ lines }: { lines: ProofOrderLine[] }) {
  return (
    <table className="w-full border-collapse text-[8px] leading-3">
      <thead>
        <tr className="text-white" style={{ backgroundColor: NAVY }}>
          {['Name', 'Brand', 'Garment', 'SKU', 'Colour', ...SIZE_COLUMNS, 'Total'].map((column) => (
            <th key={column} className="border border-white/25 px-1 py-1 text-left font-semibold">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr>
            <td
              className="border border-gray-200 px-2 py-5 text-center text-gray-500"
              colSpan={SIZE_COLUMNS.length + 6}
            >
              No order lines
            </td>
          </tr>
        ) : (
          lines.map((line) => (
            <tr key={line.id}>
              <td className="border border-gray-200 px-1 py-1">{line.name || '-'}</td>
              <td className="border border-gray-200 px-1 py-1">{line.brand || '-'}</td>
              <td className="border border-gray-200 px-1 py-1">{line.garment || '-'}</td>
              <td className="border border-gray-200 px-1 py-1">{line.sku || '-'}</td>
              <td className="border border-gray-200 px-1 py-1">{line.colour || '-'}</td>
              {SIZE_COLUMNS.map((column) => (
                <td key={column} className="border border-gray-200 px-1 py-1 text-center">
                  {line.quantities[column] || '-'}
                </td>
              ))}
              <td className="border border-gray-200 px-1 py-1 text-center font-semibold">
                {calculateLineTotal(line)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function MockupPanel({
  label,
  imageUrl,
  designName,
}: {
  label: string
  imageUrl: string
  designName: string
}) {
  return (
    <div className="flex h-full flex-col border border-gray-300 bg-gray-50">
      <div
        className="px-3 py-1.5 text-[10px] font-bold uppercase text-white"
        style={{ backgroundColor: NAVY }}
      >
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={`${designName} ${label.toLowerCase()} mockup`}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="text-center text-xs text-gray-400">{designName}</div>
        )}
      </div>
    </div>
  )
}

function Spec({
  label,
  value,
  wide = false,
}: {
  label: string
  value: ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className="mt-0.5 font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function methodLabel(method: string): string {
  return method.replace('_', ' ').toUpperCase()
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[] as T[]]
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
