import type { TourDefinition, Audience } from '../types';

const ID_PATTERN = /^[a-z_]+\.[a-z_-]+$/;
const AUDIENCES: Audience[] = ['staff', 'org_admin', 'buyer'];

export function defineTour(tour: TourDefinition): TourDefinition {
  if (!tour.id || tour.id.length === 0) {
    throw new Error('defineTour: id must be a non-empty string');
  }
  if (!tour.id.includes('.')) {
    throw new Error(
      `defineTour: id "${tour.id}" must include a namespace prefix (e.g. "staff.example")`
    );
  }
  if (!ID_PATTERN.test(tour.id)) {
    throw new Error(
      `defineTour: id "${tour.id}" has invalid format — must match ${ID_PATTERN}`
    );
  }
  if (!AUDIENCES.includes(tour.audience)) {
    throw new Error(
      `defineTour: audience "${tour.audience}" is not one of ${AUDIENCES.join(', ')}`
    );
  }
  if (!Array.isArray(tour.steps) || tour.steps.length === 0) {
    throw new Error(`defineTour: steps must be a non-empty array`);
  }
  tour.steps.forEach((step, idx) => {
    if (!step.target.startsWith('[data-tour=')) {
      throw new Error(
        `defineTour: step[${idx}] target "${step.target}" must use a [data-tour="..."] selector`
      );
    }
  });
  return tour;
}
