import type { SupabaseClient } from '@supabase/supabase-js';
import type { TourVideo } from '../types';

export interface VideoClient {
  fetchAll(): Promise<Record<string, TourVideo>>;
  fetchOne(tourId: string): Promise<TourVideo | null>;
}

interface Row {
  tour_id: string;
  loom_url: string;
  recorded_at: string;
  is_stale: boolean;
  last_checked_at: string | null;
}

function rowToVideo(row: Row): TourVideo {
  return {
    tourId: row.tour_id,
    loomUrl: row.loom_url,
    recordedAt: row.recorded_at,
    isStale: row.is_stale,
    lastCheckedAt: row.last_checked_at,
  };
}

export function createVideoClient(supabase: SupabaseClient): VideoClient {
  return {
    async fetchAll() {
      const { data, error } = await supabase.from('tour_videos').select('*');
      if (error) throw new Error(error.message);
      const map: Record<string, TourVideo> = {};
      (data as Row[]).forEach((r) => {
        map[r.tour_id] = rowToVideo(r);
      });
      return map;
    },
    async fetchOne(tourId) {
      const { data, error } = await supabase
        .from('tour_videos')
        .select('*')
        .eq('tour_id', tourId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? rowToVideo(data as Row) : null;
    },
  };
}
