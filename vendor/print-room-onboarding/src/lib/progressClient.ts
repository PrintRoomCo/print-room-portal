import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserOnboardingProgress } from '../types';

export interface ProgressClient {
  fetch(): Promise<UserOnboardingProgress>;
  markTourComplete(tourId: string): Promise<void>;
  tickChecklist(key: string): Promise<void>;
  dismissFirstLogin(): Promise<void>;
}

interface Row {
  user_id: string;
  completed_tours: string[];
  checklist_items: Record<string, { done_at?: string; dismissed?: boolean }>;
  dismissed_first_login: boolean;
}

function rowToProgress(row: Row): UserOnboardingProgress {
  return {
    userId: row.user_id,
    completedTours: row.completed_tours ?? [],
    checklistItems: row.checklist_items ?? {},
    dismissedFirstLogin: row.dismissed_first_login ?? false,
  };
}

export function createProgressClient(
  supabase: SupabaseClient,
  userId: string
): ProgressClient {
  let cached: UserOnboardingProgress | null = null;

  async function getCurrent(): Promise<UserOnboardingProgress> {
    if (cached) return cached;
    const { data, error } = await supabase
      .from('user_onboarding_progress')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error) throw new Error(error.message);
    cached = rowToProgress(data as Row);
    return cached;
  }

  async function writeRow(next: UserOnboardingProgress): Promise<void> {
    const { error } = await supabase.from('user_onboarding_progress').upsert({
      user_id: userId,
      completed_tours: next.completedTours,
      checklist_items: next.checklistItems,
      dismissed_first_login: next.dismissedFirstLogin,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    cached = next;
  }

  return {
    async fetch() {
      cached = null;
      return getCurrent();
    },
    async markTourComplete(tourId) {
      const current = await getCurrent();
      const next: UserOnboardingProgress = {
        ...current,
        completedTours: current.completedTours.includes(tourId)
          ? current.completedTours
          : [...current.completedTours, tourId],
      };
      await writeRow(next);
    },
    async tickChecklist(key) {
      const current = await getCurrent();
      const next: UserOnboardingProgress = {
        ...current,
        checklistItems: {
          ...current.checklistItems,
          [key]: { done_at: new Date().toISOString() },
        },
      };
      await writeRow(next);
    },
    async dismissFirstLogin() {
      const current = await getCurrent();
      const next: UserOnboardingProgress = { ...current, dismissedFirstLogin: true };
      await writeRow(next);
    },
  };
}
