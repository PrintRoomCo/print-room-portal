'use client'

import { useRef, useState } from 'react'
import type { Decoration } from './QuoteBuilder'

interface Props {
  decoration: Decoration
  onChange: (d: Decoration) => void
  onOpenDesignPicker: () => void
  quoteSessionId: string
  artworkUploadUrl: string
}

export function ArtworkUpload({ decoration, onChange, onOpenDesignPicker, quoteSessionId, artworkUploadUrl }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      // Get signed URL
      const res = await fetch(artworkUploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          quoteSessionId,
          fileSize: file.size,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Upload failed')
        return
      }

      const { signedUrl, storagePath } = await res.json()

      // Upload to Supabase Storage
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      })

      if (!uploadRes.ok) {
        alert('File upload failed. Please try again.')
        return
      }

      onChange({
        ...decoration,
        artworkType: 'custom',
        artworkFileId: storagePath,
        _artworkFileName: file.name,
      })
    } catch {
      alert('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">Artwork</label>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className="btn-secondary text-xs py-1.5 px-3"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading...' : 'Upload file'}
        </button>
        <button className="btn-ghost text-xs" onClick={onOpenDesignPicker}>
          Use standard design
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.ai,.eps,.svg"
          onChange={handleUpload}
        />
        {decoration._artworkFileName && (
          <span className="text-xs bg-gray-100 rounded-full px-3 py-1 text-muted-foreground">
            {decoration._artworkFileName}
          </span>
        )}
        {decoration._standardDesignName && (
          <span className="glass-badge-blue text-xs">
            Design: {decoration._standardDesignName}
          </span>
        )}
      </div>
    </div>
  )
}
