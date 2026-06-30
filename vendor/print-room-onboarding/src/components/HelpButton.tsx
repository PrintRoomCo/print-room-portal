'use client';

import { useTour } from './TourProvider';
import { HelpPanel } from './HelpPanel';

export interface HelpButtonProps {
  currentRoute?: string;
  /**
   * Optional data-tour selector applied to the real (fixed-position) button.
   * A wrapping element can't carry it — a div around a position:fixed child
   * collapses to a zero-rect, which breaks spotlight cutouts.
   */
  dataTour?: string;
}

export function HelpButton({ currentRoute, dataTour }: HelpButtonProps) {
  const { isHelpOpen, setHelpOpen } = useTour();

  return (
    <>
      <button
        type="button"
        aria-label="Open help"
        aria-expanded={isHelpOpen}
        onClick={() => setHelpOpen(!isHelpOpen)}
        className="oonb-help-button"
        data-tour={dataTour}
      >
        ?
      </button>
      {isHelpOpen && (
        <HelpPanel currentRoute={currentRoute} onClose={() => setHelpOpen(false)} />
      )}
    </>
  );
}
