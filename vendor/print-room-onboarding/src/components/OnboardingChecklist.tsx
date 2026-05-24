'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTour } from './TourProvider';
import type { ChecklistItem } from '../types';

export interface OnboardingChecklistProps {
  items: ChecklistItem[];
}

export function OnboardingChecklist({ items }: OnboardingChecklistProps) {
  const { progress, isChecklistOpen, setChecklistOpen } = useTour();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const enriched = useMemo(() => {
    return items.map((i) => ({
      ...i,
      doneAt: progress?.checklistItems?.[i.key]?.done_at,
    }));
  }, [items, progress]);

  const doneCount = enriched.filter((i) => !!i.doneAt).length;
  const total = enriched.length;
  const allDone = total > 0 && doneCount === total;

  if (total === 0) return null;
  if (allDone && !isChecklistOpen) return null;

  if (!isChecklistOpen) {
    return (
      <button
        type="button"
        className="oonb-checklist-badge"
        aria-label={`Onboarding checklist: ${doneCount} of ${total} done`}
        onClick={() => setChecklistOpen(true)}
      >
        <ProgressRing
          percent={total === 0 ? 0 : (doneCount / total) * 100}
          label={`${doneCount}/${total}`}
        />
        <span className="oonb-checklist-badge-text">
          <strong>Get started</strong>
          <span>{total - doneCount} task{total - doneCount === 1 ? '' : 's'} left</span>
        </span>
      </button>
    );
  }

  if (!mounted) return null;

  return createPortal(
    <div className="oonb-checklist-panel" role="region" aria-label="Onboarding checklist">
      <div className="oonb-checklist-header">
        <strong>Get started</strong>
        <span>{doneCount} of {total} done</span>
        <button
          type="button"
          aria-label="Collapse"
          onClick={() => setChecklistOpen(false)}
          className="oonb-help-close"
        >
          ▾
        </button>
      </div>
      <div className="oonb-checklist-bar">
        <div
          className="oonb-checklist-bar-fill"
          style={{ width: `${(doneCount / Math.max(total, 1)) * 100}%` }}
        />
      </div>
      <ul className="oonb-checklist-list">
        {enriched.map((i) => (
          <li key={i.key} className={i.doneAt ? 'is-done' : ''}>
            <span aria-hidden="true">{i.doneAt ? '✓' : '○'}</span>
            <span>{i.label}</span>
          </li>
        ))}
      </ul>
      <p className="oonb-checklist-footer">When complete: you're ready to invite customers.</p>
    </div>,
    document.body,
  );
}

function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="3" />
      <circle
        cx="18" cy="18" r={r}
        fill="none"
        stroke="rgba(43,57,144,1)"
        strokeWidth="3"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="22" textAnchor="middle" fontSize="10" fontWeight="600" fill="rgba(0,0,0,0.85)">
        {label}
      </text>
    </svg>
  );
}
