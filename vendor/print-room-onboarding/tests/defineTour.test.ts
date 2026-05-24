import { describe, it, expect } from 'vitest';
import { defineTour } from '../src/lib/defineTour';

const baseTour = {
  id: 'staff.example',
  audience: 'staff' as const,
  title: 'Example',
  duration: '~1 min',
  steps: [
    { target: '[data-tour="x"]', title: 'X', body: 'Click X.' },
  ],
};

describe('defineTour', () => {
  it('returns the tour unchanged when valid', () => {
    const t = defineTour(baseTour);
    expect(t.id).toBe('staff.example');
    expect(t.steps).toHaveLength(1);
  });

  it('rejects empty id', () => {
    expect(() => defineTour({ ...baseTour, id: '' })).toThrow(/id/);
  });

  it('rejects id without namespace', () => {
    expect(() => defineTour({ ...baseTour, id: 'example' })).toThrow(/namespace/);
  });

  it('rejects id with invalid characters', () => {
    expect(() => defineTour({ ...baseTour, id: 'Staff.Example' })).toThrow(/format/);
  });

  it('rejects audience not in enum', () => {
    expect(() =>
      // @ts-expect-error — testing runtime validation of bad input
      defineTour({ ...baseTour, audience: 'admin' })
    ).toThrow(/audience/);
  });

  it('rejects empty steps array', () => {
    expect(() => defineTour({ ...baseTour, steps: [] })).toThrow(/steps/);
  });

  it('rejects step target not starting with [data-tour=', () => {
    const bad = { ...baseTour, steps: [{ target: '.my-button', title: 'X', body: 'Y' }] };
    expect(() => defineTour(bad)).toThrow(/data-tour/);
  });
});
