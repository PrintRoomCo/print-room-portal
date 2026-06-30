const STORAGE_KEY = 'oonb.tour.in-flight';

export interface PersistedTourState {
  tourSlug: string;
  stepIndex: number;
  startedAt: number;
}

export function saveTourState(state: PersistedTourState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be disabled (private mode); silently fail — tour just won't survive.
  }
}

export function loadTourState(maxAgeMs = 10_000): PersistedTourState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTourState;
    if (Date.now() - parsed.startedAt > maxAgeMs) {
      clearTourState();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearTourState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
