export type {
  Audience,
  Placement,
  Step,
  TourDefinition,
  ChecklistItem,
  UserOnboardingProgress,
  TourVideo,
} from './types';

export { defineTour } from './lib/defineTour';
export { registerTours, getTour, getAllTours } from './lib/registry';
export { createProgressClient } from './lib/progressClient';
export type { ProgressClient } from './lib/progressClient';
export { createVideoClient } from './lib/videoClient';
export type { VideoClient } from './lib/videoClient';
export { TourProvider, useTour } from './components/TourProvider';
export { HelpButton } from './components/HelpButton';
export { OnboardingChecklist } from './components/OnboardingChecklist';
export { FirstLoginGate } from './components/FirstLoginGate';
export { VideoModal } from './components/VideoModal';
