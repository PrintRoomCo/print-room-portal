import { describe, it, expect, vi } from 'vitest';
import { createProgressClient } from '../src/lib/progressClient';

function mockSupabase(initialRow: any, opts?: { failUpsert?: boolean }) {
  const upsert = vi.fn().mockImplementation(() =>
    opts?.failUpsert
      ? { error: { message: 'boom' }, data: null }
      : { error: null, data: null }
  );
  const single = vi.fn().mockResolvedValue({ data: initialRow, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select, upsert });
  return { from, _calls: { upsert, single, eq, select } } as any;
}

describe('progressClient', () => {
  it('fetches progress for a user', async () => {
    const supabase = mockSupabase({
      user_id: 'u1',
      completed_tours: ['staff.a'],
      checklist_items: { x: { done_at: '2026-05-22' } },
      dismissed_first_login: true,
    });
    const client = createProgressClient(supabase, 'u1');
    const progress = await client.fetch();

    expect(progress.completedTours).toEqual(['staff.a']);
    expect(progress.checklistItems).toEqual({ x: { done_at: '2026-05-22' } });
    expect(progress.dismissedFirstLogin).toBe(true);
  });

  it('marks a tour complete', async () => {
    const supabase = mockSupabase({
      user_id: 'u1',
      completed_tours: ['staff.a'],
      checklist_items: {},
      dismissed_first_login: false,
    });
    const client = createProgressClient(supabase, 'u1');
    await client.markTourComplete('staff.b');

    expect(supabase._calls.upsert).toHaveBeenCalled();
    const upsertArg = supabase._calls.upsert.mock.calls[0][0];
    expect(upsertArg.completed_tours).toContain('staff.a');
    expect(upsertArg.completed_tours).toContain('staff.b');
  });

  it('ticks a checklist item', async () => {
    const supabase = mockSupabase({
      user_id: 'u1',
      completed_tours: [],
      checklist_items: {},
      dismissed_first_login: false,
    });
    const client = createProgressClient(supabase, 'u1');
    await client.tickChecklist('first_catalogue');

    const upsertArg = supabase._calls.upsert.mock.calls[0][0];
    expect(upsertArg.checklist_items.first_catalogue.done_at).toBeDefined();
  });

  it('dismisses first-login flag', async () => {
    const supabase = mockSupabase({
      user_id: 'u1',
      completed_tours: [],
      checklist_items: {},
      dismissed_first_login: false,
    });
    const client = createProgressClient(supabase, 'u1');
    await client.dismissFirstLogin();

    const upsertArg = supabase._calls.upsert.mock.calls[0][0];
    expect(upsertArg.dismissed_first_login).toBe(true);
  });

  it('throws on upsert error', async () => {
    const supabase = mockSupabase(
      { user_id: 'u1', completed_tours: [], checklist_items: {}, dismissed_first_login: false },
      { failUpsert: true }
    );
    const client = createProgressClient(supabase, 'u1');
    await expect(client.markTourComplete('staff.x')).rejects.toThrow(/boom/);
  });
});
