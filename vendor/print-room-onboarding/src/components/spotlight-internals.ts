import type { AutoAdvanceOptions, TourStyle } from '../types';

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function resolveAutoAdvanceMs(
  autoAdvance: AutoAdvanceOptions | undefined,
  reducedMotion: boolean,
): number | null {
  if (reducedMotion) return null;
  if (!autoAdvance) return null;
  return autoAdvance.intervalMs;
}

/**
 * Decide whether the spotlight auto-advance timer should be scheduled for the
 * step the user is currently on.
 *
 * Pause is STEP-SCOPED: a manual interaction records the index it happened on
 * (`pausedAtIndex`). The timer is suppressed only while the user is still on
 * that exact step; advancing to any other step re-arms auto-advance. This is
 * what makes pause-on-interact non-destructive — the prior boolean flag was
 * write-once and killed auto-advance for the rest of the tour.
 */
export function shouldAutoAdvance(opts: {
  autoAdvance: AutoAdvanceOptions | undefined;
  reducedMotion: boolean;
  pausedAtIndex: number | null;
  currentIndex: number;
  totalSteps: number;
}): number | null {
  // Last step waits for an explicit Finish — auto-advancing off the final step
  // would destroy the tour ~4.5s after the closing step appears.
  if (opts.currentIndex >= opts.totalSteps - 1) return null;
  if (opts.pausedAtIndex === opts.currentIndex) return null;
  return resolveAutoAdvanceMs(opts.autoAdvance, opts.reducedMotion);
}

/**
 * Minimum step index (0-based, highest reached) a tour must hit before its
 * completion is recorded. Spotlight is forgiving (auto-advances), so an early
 * Escape should not count — reaching step 4 (index 3) is meaningful exposure.
 * Popover tours keep "any completion ticks" semantics (threshold 0).
 */
export function minCompletionIndex(
  style: TourStyle | undefined,
  totalSteps: number,
): number {
  // Spotlight needs meaningful exposure (step index 3 = the 4th area) before it
  // counts as complete — but never beyond the last step, so a short tour (e.g.
  // one permission-filtered down to a few resolvable steps) can still complete
  // by reaching its end.
  return style === 'spotlight' ? Math.min(3, totalSteps - 1) : 0;
}

/**
 * Whether a tour run should be marked complete, based on the HIGHEST step the
 * user actually reached. The caller must track this high-water mark itself —
 * driver.js wipes its internal state before `onDestroyed` fires, so reading
 * `getActiveIndex()` at teardown returns undefined and never ticks.
 */
export function shouldCompleteTour(
  style: TourStyle | undefined,
  highestStepIndexReached: number,
  totalSteps: number,
): boolean {
  return highestStepIndexReached >= minCompletionIndex(style, totalSteps);
}

/**
 * Filter a tour's steps to those whose target selector currently resolves in
 * the DOM. driver.js highlights a 0×0 dummy when a target is missing, so a
 * spotlight step pointing at a permission-gated (and therefore absent) element
 * would spotlight empty space. Callers pass an `exists` probe (typically
 * `(sel) => !!document.querySelector(sel)`) so this stays pure and testable.
 */
export function resolvableSteps<T extends { target: string }>(
  steps: T[],
  exists: (selector: string) => boolean,
): T[] {
  return steps.filter((step) => exists(step.target));
}

export interface MobileNoticeStep {
  target: 'body';
  title: string;
  body: string;
  placement: 'bottom';
}

export function mobileNoticeStep(): MobileNoticeStep {
  return {
    target: 'body',
    title: "You're on mobile",
    body:
      "The full tour works best on desktop. We'll show you the short version here — open the portal on a laptop to see every step highlighted.",
    placement: 'bottom',
  };
}

/**
 * Next index when cycling focus within the spotlight chrome's focusable
 * controls (Tab / Shift+Tab). Wraps at both ends so focus can't leak out of
 * the chrome and onto the dimmed page behind the overlay.
 */
export function nextFocusIndex(current: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return 0;
  const delta = shiftKey ? -1 : 1;
  return (current + delta + count) % count;
}
