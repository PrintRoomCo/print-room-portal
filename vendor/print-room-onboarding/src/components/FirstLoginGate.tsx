'use client';

import { useEffect, useRef } from 'react';
import { useTour } from './TourProvider';

export interface FirstLoginGateProps {
  welcomeTourId: string;
  userDisplayName?: string;
}

export function FirstLoginGate({ welcomeTourId, userDisplayName }: FirstLoginGateProps) {
  const { progress, startTour, reloadProgress } = useTour();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const startBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (progress && !progress.dismissedFirstLogin) {
      startBtnRef.current?.focus();
    }
  }, [progress]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') void dismiss(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!progress || progress.dismissedFirstLogin) return null;

  async function dismiss(startTourAfter: boolean) {
    await fetch('/api/onboarding/dismiss-first-login', { method: 'POST' });
    await reloadProgress();
    if (startTourAfter) {
      await startTour(welcomeTourId);
    }
  }

  return (
    <div className="oonb-first-login-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="oonb-first-login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oonb-first-login-title"
      >
        <p className="oonb-label">WELCOME</p>
        <h2 id="oonb-first-login-title">
          Hey{userDisplayName ? ` ${userDisplayName}` : ''} — first time here?
        </h2>
        <p>
          Take a 2-minute tour, or jump straight in. You can replay any tour from the{' '}
          <strong>?</strong> button later.
        </p>
        <div className="oonb-first-login-actions">
          <button type="button" className="pill" onClick={() => void dismiss(false)}>
            Skip — I'll explore
          </button>
          <button
            ref={startBtnRef}
            type="button"
            className="pill-cta"
            onClick={() => void dismiss(true)}
          >
            Start tour →
          </button>
        </div>
      </div>
    </div>
  );
}
