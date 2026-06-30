import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isMobileViewport,
  prefersReducedMotion,
  resolveAutoAdvanceMs,
  shouldAutoAdvance,
  shouldCompleteTour,
  resolvableSteps,
  nextFocusIndex,
} from '../src/components/spotlight-internals';

describe('spotlight-internals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('isMobileViewport', () => {
    it('returns true when matchMedia matches max-width 767px', () => {
      vi.stubGlobal('window', {
        matchMedia: (q: string) => ({ matches: q === '(max-width: 767px)' }),
      });
      expect(isMobileViewport()).toBe(true);
    });

    it('returns false when matchMedia does not match', () => {
      vi.stubGlobal('window', {
        matchMedia: () => ({ matches: false }),
      });
      expect(isMobileViewport()).toBe(false);
    });

    it('returns false when window is undefined (SSR)', () => {
      vi.stubGlobal('window', undefined);
      expect(isMobileViewport()).toBe(false);
    });
  });

  describe('prefersReducedMotion', () => {
    it('returns true when prefers-reduced-motion: reduce matches', () => {
      vi.stubGlobal('window', {
        matchMedia: (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }),
      });
      expect(prefersReducedMotion()).toBe(true);
    });

    it('returns false otherwise', () => {
      vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
      expect(prefersReducedMotion()).toBe(false);
    });

    it('returns false when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(prefersReducedMotion()).toBe(false);
    });
  });

  describe('resolveAutoAdvanceMs', () => {
    it('returns null when reducedMotion is true (auto-advance disabled)', () => {
      expect(resolveAutoAdvanceMs({ intervalMs: 4500 }, true)).toBeNull();
    });

    it('returns null when autoAdvance is undefined', () => {
      expect(resolveAutoAdvanceMs(undefined, false)).toBeNull();
    });

    it('returns intervalMs when both conditions allow', () => {
      expect(resolveAutoAdvanceMs({ intervalMs: 4500 }, false)).toBe(4500);
    });
  });

  describe('shouldAutoAdvance (step-scoped pause)', () => {
    const autoAdvance = { intervalMs: 4500 };

    it('schedules on a fresh step when nothing is paused', () => {
      expect(
        shouldAutoAdvance({ autoAdvance, reducedMotion: false, pausedAtIndex: null, currentIndex: 0, totalSteps: 12 }),
      ).toBe(4500);
    });

    it('does NOT schedule for the exact step the user paused on', () => {
      expect(
        shouldAutoAdvance({ autoAdvance, reducedMotion: false, pausedAtIndex: 2, currentIndex: 2, totalSteps: 12 }),
      ).toBeNull();
    });

    it('RESUMES auto-advance on the next step after a pause (write-once regression guard)', () => {
      expect(
        shouldAutoAdvance({ autoAdvance, reducedMotion: false, pausedAtIndex: 2, currentIndex: 3, totalSteps: 12 }),
      ).toBe(4500);
    });

    it('does NOT schedule on the last step (waits for an explicit Finish)', () => {
      expect(
        shouldAutoAdvance({ autoAdvance, reducedMotion: false, pausedAtIndex: null, currentIndex: 11, totalSteps: 12 }),
      ).toBeNull();
    });

    it('never schedules under reduced motion, even on a fresh step', () => {
      expect(
        shouldAutoAdvance({ autoAdvance, reducedMotion: true, pausedAtIndex: null, currentIndex: 0, totalSteps: 12 }),
      ).toBeNull();
    });

    it('never schedules when autoAdvance is not configured', () => {
      expect(
        shouldAutoAdvance({ autoAdvance: undefined, reducedMotion: false, pausedAtIndex: null, currentIndex: 0, totalSteps: 12 }),
      ).toBeNull();
    });
  });

  describe('shouldCompleteTour (completion gate by highest step reached)', () => {
    it('spotlight 12-step: does NOT complete below step index 3', () => {
      expect(shouldCompleteTour('spotlight', 0, 12)).toBe(false);
      expect(shouldCompleteTour('spotlight', 2, 12)).toBe(false);
    });

    it('spotlight 12-step: completes once step index 3 is reached', () => {
      expect(shouldCompleteTour('spotlight', 3, 12)).toBe(true);
      expect(shouldCompleteTour('spotlight', 11, 12)).toBe(true);
    });

    it('spotlight SHORT tour (filtered to 3 steps): completes on reaching the last step', () => {
      // Threshold is min(3, total - 1) = 2, so reaching the final step ticks.
      expect(shouldCompleteTour('spotlight', 1, 3)).toBe(false);
      expect(shouldCompleteTour('spotlight', 2, 3)).toBe(true);
    });

    it('spotlight single-step tour: any completion ticks (min(3, 0) = 0)', () => {
      expect(shouldCompleteTour('spotlight', 0, 1)).toBe(true);
    });

    it('popover completes on any step, including index 0', () => {
      expect(shouldCompleteTour('popover', 0, 5)).toBe(true);
    });

    it('treats undefined style as popover (any completion ticks)', () => {
      expect(shouldCompleteTour(undefined, 0, 5)).toBe(true);
    });
  });

  describe('resolvableSteps (drop steps whose target is not in the DOM)', () => {
    const steps = [
      { target: '[data-tour="a"]', title: 'A', body: '' },
      { target: '[data-tour="b"]', title: 'B', body: '' },
      { target: '[data-tour="c"]', title: 'C', body: '' },
    ];

    it('keeps only steps whose target resolves', () => {
      const present = new Set(['[data-tour="a"]', '[data-tour="c"]']);
      const out = resolvableSteps(steps, (sel) => present.has(sel));
      expect(out.map((s) => s.title)).toEqual(['A', 'C']);
    });

    it('returns empty when nothing resolves', () => {
      expect(resolvableSteps(steps, () => false)).toEqual([]);
    });

    it('returns all when everything resolves', () => {
      expect(resolvableSteps(steps, () => true)).toHaveLength(3);
    });
  });

  describe('nextFocusIndex (focus-trap wrap within chrome buttons)', () => {
    it('moves forward, wrapping past the last to the first', () => {
      expect(nextFocusIndex(0, 3, false)).toBe(1);
      expect(nextFocusIndex(1, 3, false)).toBe(2);
      expect(nextFocusIndex(2, 3, false)).toBe(0);
    });

    it('moves backward, wrapping before the first to the last', () => {
      expect(nextFocusIndex(2, 3, true)).toBe(1);
      expect(nextFocusIndex(0, 3, true)).toBe(2);
    });

    it('returns 0 for an empty focusable set', () => {
      expect(nextFocusIndex(0, 0, false)).toBe(0);
    });
  });
});
