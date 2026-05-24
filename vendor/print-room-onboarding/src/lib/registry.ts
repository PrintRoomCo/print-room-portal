import type { TourDefinition } from '../types';

const registry = new Map<string, TourDefinition>();

export function registerTours(tours: TourDefinition[]): void {
  const seenIds = new Set<string>();
  for (const tour of tours) {
    if (seenIds.has(tour.id)) {
      throw new Error(`registerTours: duplicate tour id "${tour.id}"`);
    }
    seenIds.add(tour.id);
    registry.set(tour.id, tour);
  }
}

export function getTour(id: string): TourDefinition | undefined {
  return registry.get(id);
}

export function getAllTours(): TourDefinition[] {
  return Array.from(registry.values());
}

/** Test-only helper. Do not call from app code. */
export function _clearRegistry(): void {
  registry.clear();
}
