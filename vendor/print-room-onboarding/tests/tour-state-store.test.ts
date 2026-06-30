import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  saveTourState,
  loadTourState,
  clearTourState,
} from '../src/lib/tour-state-store';

function makeSessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

describe('tour-state-store', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', makeSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips state within the freshness window', () => {
    saveTourState({ tourSlug: 'staff.welcome', stepIndex: 3, startedAt: Date.now() });
    const got = loadTourState();
    expect(got?.tourSlug).toBe('staff.welcome');
    expect(got?.stepIndex).toBe(3);
  });

  it('returns null when no state stored', () => {
    expect(loadTourState()).toBeNull();
  });

  it('expires state past the max age', () => {
    saveTourState({
      tourSlug: 'staff.welcome',
      stepIndex: 3,
      startedAt: Date.now() - 20_000,
    });
    expect(loadTourState(10_000)).toBeNull();
  });

  it('clear removes the state', () => {
    saveTourState({ tourSlug: 'staff.welcome', stepIndex: 0, startedAt: Date.now() });
    clearTourState();
    expect(loadTourState()).toBeNull();
  });
});
