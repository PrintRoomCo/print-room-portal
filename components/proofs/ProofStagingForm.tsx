'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { SIZE_COLUMNS, type ProofDocument } from '@/lib/proofs/types'

interface ProofStagingFormProps {
  proofId: string
  orderId: string
  versionId: string
  initialDocument: ProofDocument
  amName: string
  /**
   * Customer-editable field allow-list, loaded server-side from
   * `proof_editable_field_paths` and passed in by the parent page. Kept as
   * a prop because client components can't `await` the loader directly.
   * The server route is the authoritative gate — this is defence-in-depth
   * context for UI affordances only.
   */
  allowedPaths: string[]
}

interface SubmitErrorState {
  message: string
  field?: string
  instancePath?: string
  stale?: { currentVersionId: string; stagedSnapshot: ProofDocument }
}

/**
 * Customer staging editor. Renders editable inputs for fields on the
 * customer-editable allow-list (passed in as `allowedPaths`, sourced from
 * the DB-backed `proof_editable_field_paths` table) and renders everything
 * else as read-only context.
 *
 * Defence-in-depth only — the security boundary is the API route at
 * /api/proofs/[id]/amendment-requests. If a malicious client crafts a
 * payload that touches a non-allow-listed field, the server rejects 400
 * with `field_not_editable` and we surface that error.
 */
export function ProofStagingForm({
  proofId,
  orderId,
  versionId,
  initialDocument,
  amName,
  allowedPaths,
}: ProofStagingFormProps) {
  const router = useRouter()
  const [doc, setDoc] = useState<ProofDocument>(initialDocument)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<SubmitErrorState | null>(null)

  const handleCancel = () => {
    router.push(`/orders/${orderId}/proof`)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/proofs/${proofId}/amendment-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionId,
          stagedSnapshot: doc,
          body: note.trim() || undefined,
        }),
      })

      if (res.status === 201) {
        router.push(`/orders/${orderId}/proof?amendment=submitted`)
        return
      }

      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>

      if (res.status === 409 && payload.error === 'proof_updated') {
        // Don't lose the customer's work. Keep doc state, surface a banner.
        setError({
          message:
            typeof payload.message === 'string'
              ? payload.message
              : 'The proof was updated while you were editing. Refresh and try again.',
          stale: {
            currentVersionId:
              typeof payload.currentVersionId === 'string' ? payload.currentVersionId : '',
            stagedSnapshot: doc,
          },
        })
        setSubmitting(false)
        return
      }

      if (res.status === 400 && payload.error === 'field_not_editable') {
        setError({
          message: 'Some of your edits change a field only Print Room staff can edit.',
          field: typeof payload.field === 'string' ? payload.field : undefined,
          instancePath:
            typeof payload.instancePath === 'string' ? payload.instancePath : undefined,
        })
        setSubmitting(false)
        return
      }

      if (res.status === 400 && payload.error === 'no_changes') {
        setError({ message: 'No changes detected. Edit a field before submitting.' })
        setSubmitting(false)
        return
      }

      setError({
        message:
          typeof payload.error === 'string'
            ? `Submit failed: ${payload.error}`
            : 'Submit failed. Try again or contact us.',
      })
      setSubmitting(false)
    } catch (err) {
      console.error('[ProofStagingForm] submit error', err)
      setError({ message: 'Network error — your edits are still here. Try submit again.' })
      setSubmitting(false)
    }
  }

  // Recompute the change-count for the submit button label.
  const changeCount = useMemo(() => countSurfaceChanges(initialDocument, doc), [initialDocument, doc])

  return (
    <form
      className="space-y-6"
      onSubmit={handleSubmit}
      data-allowed-paths-count={allowedPaths.length}
    >
      <div
        className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
        role="status"
      >
        Your edits below are a <em>request</em> — they will not change the proof until{' '}
        {amName} reviews them.
      </div>

      {error && (
        <div
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
          role="alert"
        >
          <p className="font-semibold">{error.message}</p>
          {error.field && (
            <p className="mt-1 text-xs">
              Field: <code className="rounded bg-red-100 px-1">{error.field}</code>
              {error.instancePath ? (
                <>
                  {' '}
                  at <code className="rounded bg-red-100 px-1">{error.instancePath}</code>
                </>
              ) : null}
            </p>
          )}
          {error.stale && (
            <p className="mt-2 text-xs">
              Your edits are kept on this page. Refresh to see the updated proof, then re-apply
              your changes.
            </p>
          )}
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
        <h2 className="text-base font-semibold text-gray-900">Job notes</h2>
        <label className="block">
          <span className="text-xs font-medium tracking-wide text-gray-500">
            Additional job notes
          </span>
          <textarea
            className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
            rows={3}
            value={doc.notes}
            onChange={(event) => setDoc({ ...doc, notes: event.target.value })}
          />
        </label>
      </section>

      {doc.designs.map((design, dIndex) => (
        <section
          key={design.id}
          className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 md:p-6"
        >
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">
                Design {design.index || dIndex + 1}
              </h2>
              {isSourceLocked(design.sourceMode) && (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">
                  Product from catalogue
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">
              Garment: {design.garmentLabel || '-'}
            </span>
          </header>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium tracking-wide text-gray-500">
                Design name
              </span>
              <input
                type="text"
                className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
                readOnly={isSourceLocked(design.sourceMode)}
                value={design.name}
                onChange={(event) => {
                  if (isSourceLocked(design.sourceMode)) return
                  const next = [...doc.designs]
                  next[dIndex] = { ...design, name: event.target.value }
                  setDoc({ ...doc, designs: next })
                }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium tracking-wide text-gray-500">
                Subtitle
              </span>
              <input
                type="text"
                className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
                readOnly={isSourceLocked(design.sourceMode)}
                value={design.subtitle}
                onChange={(event) => {
                  if (isSourceLocked(design.sourceMode)) return
                  const next = [...doc.designs]
                  next[dIndex] = { ...design, subtitle: event.target.value }
                  setDoc({ ...doc, designs: next })
                }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium tracking-wide text-gray-500">
                Colour name
              </span>
              <input
                type="text"
                className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
                readOnly={isSourceLocked(design.sourceMode)}
                value={design.colourName}
                onChange={(event) => {
                  if (isSourceLocked(design.sourceMode)) return
                  const next = [...doc.designs]
                  next[dIndex] = { ...design, colourName: event.target.value }
                  setDoc({ ...doc, designs: next })
                }}
              />
            </label>
          </div>

          {design.printAreas.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-gray-500">
                Print areas
              </p>
              <div className="space-y-3">
                {design.printAreas.map((area, aIndex) => (
                  <div
                    key={area.id}
                    className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-3 md:grid-cols-4"
                  >
                    <label className="block md:col-span-2">
                      <span className="text-xs font-medium tracking-wide text-gray-500">
                        Label
                      </span>
                      <input
                        type="text"
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
                        readOnly={isSourceLocked(design.sourceMode)}
                        value={area.label}
                        onChange={(event) => {
                          if (isSourceLocked(design.sourceMode)) return
                          const nextDesigns = [...doc.designs]
                          const nextAreas = [...design.printAreas]
                          nextAreas[aIndex] = { ...area, label: event.target.value }
                          nextDesigns[dIndex] = { ...design, printAreas: nextAreas }
                          setDoc({ ...doc, designs: nextDesigns })
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium tracking-wide text-gray-500">
                        Width (mm)
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
                        readOnly={isSourceLocked(design.sourceMode)}
                        value={area.widthMm}
                        onChange={(event) => {
                          if (isSourceLocked(design.sourceMode)) return
                          const nextDesigns = [...doc.designs]
                          const nextAreas = [...design.printAreas]
                          nextAreas[aIndex] = { ...area, widthMm: event.target.value }
                          nextDesigns[dIndex] = { ...design, printAreas: nextAreas }
                          setDoc({ ...doc, designs: nextDesigns })
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium tracking-wide text-gray-500">
                        Height (mm)
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
                        readOnly={isSourceLocked(design.sourceMode)}
                        value={area.heightMm}
                        onChange={(event) => {
                          if (isSourceLocked(design.sourceMode)) return
                          const nextDesigns = [...doc.designs]
                          const nextAreas = [...design.printAreas]
                          nextAreas[aIndex] = { ...area, heightMm: event.target.value }
                          nextDesigns[dIndex] = { ...design, printAreas: nextAreas }
                          setDoc({ ...doc, designs: nextDesigns })
                        }}
                      />
                    </label>
                    <p className="md:col-span-4 text-[11px] text-gray-500">
                      Method ({area.method}), colour ({area.pantone || '-'}), and artwork status
                      are managed by Print Room staff.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ))}

      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
        <h2 className="text-base font-semibold text-gray-900">Order lines</h2>
        <p className="text-xs text-gray-500">
          You can edit line name, colour, and per-size quantities. SKU, brand, and design
          assignment are staff-managed.
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-white text-gray-600">
              <tr>
                <th className="border border-gray-200 px-2 py-1 text-left">Name</th>
                <th className="border border-gray-200 px-2 py-1 text-left">Colour</th>
                <th className="border border-gray-200 px-2 py-1 text-left">SKU</th>
                {SIZE_COLUMNS.map((column) => (
                  <th key={column} className="border border-gray-200 px-1 py-1 text-center">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.orderLines.map((line, lIndex) => (
                <tr key={line.id}>
                  <td className="border border-gray-200 p-1">
                    <input
                      type="text"
                      className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs"
                      readOnly={isSourceLocked(line.sourceMode)}
                      value={line.name}
                      onChange={(event) => {
                        if (isSourceLocked(line.sourceMode)) return
                        const next = [...doc.orderLines]
                        next[lIndex] = { ...line, name: event.target.value }
                        setDoc({ ...doc, orderLines: next })
                      }}
                    />
                  </td>
                  <td className="border border-gray-200 p-1">
                    <input
                      type="text"
                      className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs"
                      readOnly={isSourceLocked(line.sourceMode)}
                      value={line.colour}
                      onChange={(event) => {
                        if (isSourceLocked(line.sourceMode)) return
                        const next = [...doc.orderLines]
                        next[lIndex] = { ...line, colour: event.target.value }
                        setDoc({ ...doc, orderLines: next })
                      }}
                    />
                  </td>
                  <td className="border border-gray-200 p-1 text-gray-500">
                    {line.sku || '-'}
                  </td>
                  {SIZE_COLUMNS.map((column) => (
                    <td key={column} className="border border-gray-200 p-0.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="w-14 rounded border border-gray-300 px-1 py-0.5 text-center text-xs"
                        value={line.quantities[column] || ''}
                        onChange={(event) => {
                          const next = [...doc.orderLines]
                          next[lIndex] = {
                            ...line,
                            quantities: {
                              ...line.quantities,
                              [column]: event.target.value,
                            },
                          }
                          setDoc({ ...doc, orderLines: next })
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
        <h2 className="text-base font-semibold text-gray-900">Note for the team (optional)</h2>
        <textarea
          className="block w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-pr-blue focus:ring-pr-blue"
          rows={3}
          placeholder="Anything that doesn't fit in the fields above…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90 disabled:opacity-50"
        >
          {submitting
            ? 'Submitting…'
            : changeCount > 0
              ? `Submit ${changeCount} edit${changeCount === 1 ? '' : 's'}`
              : 'Submit request'}
        </button>
      </div>
    </form>
  )
}

function isSourceLocked(sourceMode: string | undefined): boolean {
  return sourceMode === 'catalogue_product' || sourceMode === 'customer_order_catalogue_product'
}

/** Count of surface-level edits — purely for the button label. Server is
 *  the authoritative diff calculator. */
function countSurfaceChanges(before: ProofDocument, after: ProofDocument): number {
  let count = 0
  if (before.notes !== after.notes) count++

  const len = Math.min(before.designs.length, after.designs.length)
  for (let i = 0; i < len; i++) {
    const b = before.designs[i]!
    const a = after.designs[i]!
    if (b.name !== a.name) count++
    if (b.subtitle !== a.subtitle) count++
    if (b.colourName !== a.colourName) count++
    const aLen = Math.min(b.printAreas.length, a.printAreas.length)
    for (let j = 0; j < aLen; j++) {
      if (b.printAreas[j]!.label !== a.printAreas[j]!.label) count++
      if (b.printAreas[j]!.widthMm !== a.printAreas[j]!.widthMm) count++
      if (b.printAreas[j]!.heightMm !== a.printAreas[j]!.heightMm) count++
    }
  }

  const olLen = Math.min(before.orderLines.length, after.orderLines.length)
  for (let i = 0; i < olLen; i++) {
    const b = before.orderLines[i]!
    const a = after.orderLines[i]!
    if (b.name !== a.name) count++
    if (b.colour !== a.colour) count++
    const sizes = new Set([...Object.keys(b.quantities), ...Object.keys(a.quantities)])
    for (const s of sizes) {
      if ((b.quantities[s] || '') !== (a.quantities[s] || '')) count++
    }
  }
  return count
}
