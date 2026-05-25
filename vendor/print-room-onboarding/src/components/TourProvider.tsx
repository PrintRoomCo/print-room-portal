'use client';

import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { driver, type Driver } from 'driver.js';
import type { TourDefinition, UserOnboardingProgress } from '../types';
import type { ProgressClient } from '../lib/progressClient';
import type { VideoClient } from '../lib/videoClient';
import { getTour, registerTours } from '../lib/registry';
import { isMobileViewport } from './spotlight-internals';
import { SpotlightChrome } from './SpotlightChrome';

export interface SpotlightState {
  tour: TourDefinition;
  step: TourDefinition['steps'][number];
  index: number;
  total: number;
  moveNext: () => void;
  movePrev: () => void;
  exit: () => void;
}

interface TourContextValue {
  startTour: (id: string) => Promise<void>;
  endTour: () => void;
  currentTourId: string | null;
  progress: UserOnboardingProgress | null;
  reloadProgress: () => Promise<void>;
  videosByTourId: Record<string, { loomUrl: string; isStale: boolean }>;
  isHelpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  isChecklistOpen: boolean;
  setChecklistOpen: (open: boolean) => void;
  spotlight: SpotlightState | null;  // wired in Phase C
}

const Ctx = createContext<TourContextValue | null>(null);

interface TourProviderProps {
  tours: TourDefinition[];
  progressClient: ProgressClient;
  videoClient: VideoClient;
  children: ReactNode;
}

export function TourProvider({
  tours,
  progressClient,
  videoClient,
  children,
}: TourProviderProps) {
  const [progress, setProgress] = useState<UserOnboardingProgress | null>(null);
  const [videosByTourId, setVideos] = useState<TourContextValue['videosByTourId']>({});
  const [currentTourId, setCurrentTourId] = useState<string | null>(null);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isChecklistOpen, setChecklistOpen] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);
  const driverRef = useRef<Driver | null>(null);

  async function reloadProgress() {
    const p = await progressClient.fetch();
    setProgress(p);
  }

  useEffect(() => {
    if (tours.length > 0) registerTours(tours);
    void reloadProgress();
    void videoClient.fetchAll().then((map) => {
      const flattened: TourContextValue['videosByTourId'] = {};
      Object.entries(map).forEach(([id, v]) => {
        flattened[id] = { loomUrl: v.loomUrl, isStale: v.isStale };
      });
      setVideos(flattened);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTour(id: string) {
    const tour = getTour(id);
    if (!tour) {
      // eslint-disable-next-line no-console
      console.warn(`startTour: unknown tour id "${id}"`);
      return;
    }
    if (tour.prerequisite && !(await tour.prerequisite())) return;

    const useSpotlight = tour.style === 'spotlight' && !isMobileViewport();

    setCurrentTourId(id);

    const baseSteps = tour.steps.map((s) => ({
      element: s.target,
      popover: {
        title: s.title,
        description:
          s.body + (s.aside ? `<div class="oonb-aside">${s.aside}</div>` : ''),
        side: s.placement ?? 'bottom',
      },
    }));

    const d = driver({
      animate: true,
      smoothScroll: true,
      popoverClass: useSpotlight ? 'oonb-spotlight-driver-popover' : undefined,
      showProgress: !useSpotlight,
      showButtons: useSpotlight ? [] : ['next', 'previous', 'close'],
      stagePadding: useSpotlight ? 12 : 6,
      stageRadius: useSpotlight ? 8 : 4,
      overlayOpacity: useSpotlight ? 0.7 : 0.5,
      onHighlightStarted: useSpotlight
        ? (_el, _step, opts) => {
            const idx = opts.state.activeIndex ?? 0;
            setSpotlight({
              tour,
              step: tour.steps[idx],
              index: idx,
              total: tour.steps.length,
              moveNext: () => driverRef.current?.moveNext(),
              movePrev: () => driverRef.current?.movePrevious(),
              exit: () => driverRef.current?.destroy(),
            });
          }
        : undefined,
      onDestroyed: () => {
        const completedSteps = driverRef.current?.getActiveIndex() ?? 0;
        const minCompletion = tour.style === 'spotlight' ? 3 : 0;
        const shouldTick = completedSteps >= minCompletion;
        void (async () => {
          if (shouldTick) {
            await progressClient.markTourComplete(id);
            if (tour.checklistKey) {
              await progressClient.tickChecklist(tour.checklistKey);
            }
          }
          await reloadProgress();
          setCurrentTourId(null);
          setSpotlight(null);
        })();
      },
      steps: baseSteps,
    });
    driverRef.current = d;
    d.drive();
  }

  function endTour() {
    driverRef.current?.destroy();
    driverRef.current = null;
    setCurrentTourId(null);
  }

  const value = useMemo<TourContextValue>(() => ({
    startTour, endTour, currentTourId, progress, reloadProgress,
    videosByTourId, isHelpOpen, setHelpOpen, isChecklistOpen, setChecklistOpen,
    spotlight,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentTourId, progress, videosByTourId, isHelpOpen, isChecklistOpen, spotlight]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {spotlight && <SpotlightChrome />}
    </Ctx.Provider>
  );
}

export function useTour() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>');
  return ctx;
}
