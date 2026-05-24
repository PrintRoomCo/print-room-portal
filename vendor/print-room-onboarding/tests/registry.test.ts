import { describe, it, expect, beforeEach } from 'vitest';
import { defineTour } from '../src/lib/defineTour';
import { registerTours, getTour, getAllTours, _clearRegistry } from '../src/lib/registry';

const tourA = defineTour({
  id: 'staff.a',
  audience: 'staff',
  title: 'A',
  duration: '~1 min',
  steps: [{ target: '[data-tour="a"]', title: 'A', body: 'a' }],
});

const tourB = defineTour({
  id: 'staff.b',
  audience: 'staff',
  title: 'B',
  duration: '~1 min',
  steps: [{ target: '[data-tour="b"]', title: 'B', body: 'b' }],
});

describe('registry', () => {
  beforeEach(() => _clearRegistry());

  it('registers and retrieves tours by id', () => {
    registerTours([tourA, tourB]);
    expect(getTour('staff.a')?.id).toBe('staff.a');
    expect(getTour('staff.b')?.id).toBe('staff.b');
  });

  it('returns all registered tours', () => {
    registerTours([tourA, tourB]);
    expect(getAllTours()).toHaveLength(2);
  });

  it('throws on duplicate id', () => {
    expect(() => registerTours([tourA, tourA])).toThrow(/duplicate/);
  });

  it('returns undefined for unknown id', () => {
    registerTours([tourA]);
    expect(getTour('staff.unknown')).toBeUndefined();
  });
});
