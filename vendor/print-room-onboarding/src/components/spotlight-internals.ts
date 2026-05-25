import type { AutoAdvanceOptions } from '../types';

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
