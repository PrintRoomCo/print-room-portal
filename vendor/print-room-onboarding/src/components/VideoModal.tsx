'use client';

import { useEffect } from 'react';

export interface VideoModalProps {
  loomUrl: string;
  isStale?: boolean;
  title?: string;
  onClose: () => void;
}

function toEmbedUrl(loomUrl: string): string {
  const m = loomUrl.match(/loom\.com\/share\/([a-z0-9]+)/i);
  if (!m) return loomUrl;
  return `https://www.loom.com/embed/${m[1]}`;
}

export function VideoModal({ loomUrl, isStale, title, onClose }: VideoModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="oonb-video-overlay" role="presentation" onClick={onClose}>
      <div
        className="oonb-video-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Walkthrough video'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="oonb-video-header">
          <strong>{title ?? 'Walkthrough'}</strong>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="oonb-help-close"
          >
            ✕
          </button>
        </div>
        {isStale && (
          <div className="oonb-video-stale">
            This walkthrough is older than the current UI.
          </div>
        )}
        <div className="oonb-video-frame">
          <iframe
            src={toEmbedUrl(loomUrl)}
            allow="fullscreen"
            title={title ?? 'Walkthrough video'}
          />
        </div>
      </div>
    </div>
  );
}
