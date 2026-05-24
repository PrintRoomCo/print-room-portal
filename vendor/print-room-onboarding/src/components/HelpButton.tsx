'use client';

import { useTour } from './TourProvider';
import { HelpPanel } from './HelpPanel';

export interface HelpButtonProps {
  currentRoute?: string;
}

export function HelpButton({ currentRoute }: HelpButtonProps) {
  const { isHelpOpen, setHelpOpen } = useTour();

  return (
    <>
      <button
        type="button"
        aria-label="Open help"
        aria-expanded={isHelpOpen}
        onClick={() => setHelpOpen(!isHelpOpen)}
        className="oonb-help-button"
      >
        ?
      </button>
      {isHelpOpen && (
        <HelpPanel currentRoute={currentRoute} onClose={() => setHelpOpen(false)} />
      )}
    </>
  );
}
