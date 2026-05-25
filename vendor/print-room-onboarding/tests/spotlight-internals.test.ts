import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isMobileViewport,
  prefersReducedMotion,
  resolveAutoAdvanceMs,
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
});
