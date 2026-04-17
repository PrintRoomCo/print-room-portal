'use client'

import { useMemo, useRef, useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import type { JobTracker } from '@/lib/job-tracker'

export interface ReorderFormProps {
  tracker: JobTracker
  userEmail: string
  onSubmitted: () => void
  onCancel: () => void
}

const REORDER_ARTWORK_BUCKET = 'reorder-artwork'
const MAX_FILES = 5
const MAX_FILE_BYTES = 15 * 1024 * 1024

const NOTES_PLACEHOLDER =
  "Include any order details e.g. size /qty breakdown, design names, new design you're adding to the order or any additional information."

function todayIso(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
    .toISOString()
    .slice(0, 10)
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100)
}

export function ReorderForm({
  tracker,
  userEmail,
  onSubmitted,
  onCancel,
}: ReorderFormProps) {
  const pastRef = useMemo(
    () =>
      tracker.quote_number ||
      tracker.job_reference ||
      (tracker.monday_item_id ? `#${tracker.monday_item_id}` : tracker.tracker_token),
    [tracker]
  )

  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [inHandDate, setInHandDate] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const minDate = todayIso()

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files ? Array.from(event.target.files) : []
    if (picked.length === 0) {
      setFiles([])
      return
    }
    if (picked.length > MAX_FILES) {
      setError(`You can attach at most ${MAX_FILES} files.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const oversized = picked.find((f) => f.size > MAX_FILE_BYTES)
    if (oversized) {
      setError(`"${oversized.name}" is larger than 15 MB.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setError(null)
    setFiles(picked)
  }

  async function uploadFiles(): Promise<string[]> {
    if (files.length === 0) return []
    const supabase = getSupabaseBrowser()
    const urls: string[] = []
    for (const file of files) {
      const timestamp = Date.now()
      const path = `${tracker.tracker_token}/${timestamp}-${sanitiseFilename(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from(REORDER_ARTWORK_BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || undefined,
        })
      if (uploadError) {
        throw new Error(`Upload failed for ${file.name}: ${uploadError.message}`)
      }
      const { data } = supabase.storage
        .from(REORDER_ARTWORK_BUCKET)
        .getPublicUrl(path)
      if (!data?.publicUrl) {
        throw new Error(`Could not resolve public URL for ${file.name}`)
      }
      urls.push(data.publicUrl)
    }
    return urls
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const addressTrimmed = deliveryAddress.trim()
    if (addressTrimmed.length < 6) {
      setError('Please enter a full delivery address.')
      return
    }
    if (!inHandDate) {
      setError('Please choose the in-hand date.')
      return
    }

    let quantityValue: number | undefined
    if (quantity.trim().length > 0) {
      const parsed = Number(quantity)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError('Quantity must be a positive whole number.')
        return
      }
      quantityValue = parsed
    }

    setError(null)
    setSubmitting(true)
    try {
      const artworkUrls = await uploadFiles()
      const res = await fetch('/api/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackerId: tracker.id,
          deliveryAddress: addressTrimmed,
          inHandDate,
          quantity: quantityValue,
          notes: notes.trim() || undefined,
          artworkUrls: artworkUrls.length > 0 ? artworkUrls : undefined,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Failed to submit reorder request.')
      }
      onSubmitted()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to submit reorder request.'
      setError(message)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Past order reference + email — read-only chips */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ReadOnlyField label="Past order reference" value={pastRef} />
        <ReadOnlyField label="Email contact" value={userEmail} />
      </div>

      {/* Delivery address */}
      <div>
        <label
          htmlFor="reorder-delivery-address"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Delivery address <span className="text-red-500">*</span>
        </label>
        <textarea
          id="reorder-delivery-address"
          required
          rows={3}
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
          placeholder="Full delivery address — street, suburb, city, postcode"
          className="textarea-glass"
          disabled={submitting}
        />
      </div>

      {/* In-hand date */}
      <div>
        <label
          htmlFor="reorder-in-hand-date"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          In-hand date <span className="text-red-500">*</span>
        </label>
        <input
          id="reorder-in-hand-date"
          type="date"
          required
          min={minDate}
          value={inHandDate}
          onChange={(e) => setInHandDate(e.target.value)}
          className="input-glass"
          disabled={submitting}
        />
        <p className="mt-1 text-xs text-gray-500">
          The date you need the order delivered by. Typical production lead time is
          15–20 business days.
        </p>
      </div>

      {/* Qty */}
      <div>
        <label
          htmlFor="reorder-quantity"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Quantity
        </label>
        <input
          id="reorder-quantity"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Total quantity (optional)"
          className="input-glass"
          disabled={submitting}
        />
      </div>

      {/* Notes */}
      <div>
        <label
          htmlFor="reorder-notes"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Notes
        </label>
        <textarea
          id="reorder-notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={NOTES_PLACEHOLDER}
          className="textarea-glass"
          disabled={submitting}
        />
      </div>

      {/* Artwork upload */}
      <div>
        <label
          htmlFor="reorder-artwork"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Upload new artwork (optional)
        </label>
        <input
          id="reorder-artwork"
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.ai,.psd,.svg,.eps,.zip"
          onChange={handleFileChange}
          disabled={submitting}
          className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 disabled:opacity-50"
        />
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="text-xs text-gray-600 truncate">
                {file.name} ({Math.round(file.size / 1024)} KB)
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Up to {MAX_FILES} files, 15 MB each.
        </p>
      </div>

      <p className="text-xs text-gray-500">
        Your account manager will confirm pricing and send an updated proof for your
        approval.
      </p>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 btn-secondary"
          disabled={submitting}
        >
          Cancel
        </button>
        <button type="submit" className="flex-1 btn-primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit reorder'}
        </button>
      </div>
    </form>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="block text-sm font-medium text-gray-700 mb-1">{label}</p>
      <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm text-gray-700 truncate" title={value}>
        {value}
      </div>
    </div>
  )
}
