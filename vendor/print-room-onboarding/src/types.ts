export type Audience = 'staff' | 'org_admin' | 'buyer';

export type Placement = 'top' | 'right' | 'bottom' | 'left';

export type TourStyle = 'popover' | 'spotlight';

export interface AutoAdvanceOptions {
  /** Time in ms between auto-advances. Paused by any manual user interaction. */
  intervalMs: number;
}

export interface Step {
  target: string;
  title: string;
  body: string;
  placement?: Placement;
  waitFor?: 'click' | 'visible';
  aside?: string;
}

export interface TourDefinition {
  id: string;
  audience: Audience;
  title: string;
  duration: string;
  route?: string;
  videoUrl?: string;
  checklistKey?: string;
  /** Renderer style. Defaults to 'popover' (existing click-through). */
  style?: TourStyle;
  /** Auto-advance pacing. Only honoured when style === 'spotlight'. */
  autoAdvance?: AutoAdvanceOptions;
  prerequisite?: () => boolean | Promise<boolean>;
  steps: Step[];
}

export interface ChecklistItem {
  key: string;
  label: string;
  doneAt?: string;
  dismissed?: boolean;
}

export interface UserOnboardingProgress {
  userId: string;
  completedTours: string[];
  checklistItems: Record<string, { done_at?: string; dismissed?: boolean }>;
  dismissedFirstLogin: boolean;
}

export interface TourVideo {
  tourId: string;
  loomUrl: string;
  recordedAt: string;
  isStale: boolean;
  lastCheckedAt: string | null;
}
