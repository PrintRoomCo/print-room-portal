'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTour } from './TourProvider';
import { getAllTours } from '../lib/registry';
import type { TourDefinition } from '../types';

interface HelpPanelProps {
  currentRoute?: string;
  onClose: () => void;
}

export function HelpPanel({ currentRoute, onClose }: HelpPanelProps) {
  const { startTour, videosByTourId } = useTour();
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  const all = getAllTours();
  const onThisPage = currentRoute
    ? all.filter((t) => t.route && currentRoute.startsWith(t.route))
    : [];
  const others = all.filter((t) => !onThisPage.includes(t));

  if (!mounted) return null;

  return createPortal(
    <div ref={ref} className="oonb-help-panel" role="dialog" aria-label="Help">
      <div className="oonb-help-panel-header">
        <strong>Help</strong>
        <button
          type="button"
          aria-label="Close help"
          onClick={onClose}
          className="oonb-help-close"
        >
          ✕
        </button>
      </div>
      {onThisPage.length > 0 && (
        <>
          <div className="oonb-help-section-label">ON THIS PAGE</div>
          <ul className="oonb-help-list">
            {onThisPage.map((t) => (
              <TourRow
                key={t.id}
                tour={t}
                videoUrl={videosByTourId[t.id]?.loomUrl}
                onClick={() => {
                  onClose();
                  void startTour(t.id);
                }}
              />
            ))}
          </ul>
        </>
      )}
      <div className="oonb-help-section-label">ALL TOURS</div>
      <ul className="oonb-help-list">
        {others.map((t) => (
          <TourRow
            key={t.id}
            tour={t}
            videoUrl={videosByTourId[t.id]?.loomUrl}
            onClick={() => {
              onClose();
              void startTour(t.id);
            }}
          />
        ))}
      </ul>
    </div>,
    document.body,
  );
}

function TourRow({
  tour, videoUrl, onClick,
}: { tour: TourDefinition; videoUrl?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="oonb-help-row">
        <span className="oonb-help-row-title">{tour.title}</span>
        <span className="oonb-help-row-meta">
          {videoUrl && <span aria-label="Has video">📹</span>}
          <span>{tour.duration}</span>
        </span>
      </button>
    </li>
  );
}
