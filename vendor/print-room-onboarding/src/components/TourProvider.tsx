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
import {
  isMobileViewport,
  prefersReducedMotion,
  resolvableSteps,
  shouldCompleteTour,
  mobileNoticeStep,
} from './spotlight-internals';
import { SpotlightChrome } from './SpotlightChrome';
import { saveTourState, loadTourState, clearTourState } from '../lib/tour-state-store';

export interface SpotlightState {
  tour: TourDefinition;
  step: TourDefinition['steps'][number];
  index: number;
  total: number;
  moveNext: () => void;
  movePrev: () => void;
  exit: () => void;
}

interface StartTourOpts {
  initialStepIndex?: number;
  force?: boolean;
}

interface TourContextValue {
  startTour: (id: string, opts?: StartTourOpts) => Promise<void>;
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
  pathname?: string;
  children: ReactNode;
}

export function TourProvider({
  tours,
  progressClient,
  videoClient,
  pathname,
  children,
}: TourProviderProps) {
  const [progress, setProgress] = useState<UserOnboardingProgress | null>(null);
  const [videosByTourId, setVideos] = useState<TourContextValue['videosByTourId']>({});
  const [currentTourId, setCurrentTourId] = useState<string | null>(null);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isChecklistOpen, setChecklistOpen] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);
  const driverRef = useRef<Driver | null>(null);
  // Set true before destroying for navigation so onDestroyed skips clearTourState.
  const navInterruptRef = useRef(false);

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

  // A2: on soft navigation, destroy any active driver (preserving sessionStorage),
  // then resume from sessionStorage on the new page after a short render settle.
  useEffect(() => {
    if (!pathname) return;

    if (driverRef.current) {
      navInterruptRef.current = true;
      driverRef.current.destroy();
      driverRef.current = null;
      setCurrentTourId(null);
      setSpotlight(null);
    }

    const saved = loadTourState(10_000);
    if (!saved) {
      navInterruptRef.current = false;
      return;
    }

    const t = setTimeout(() => {
      navInterruptRef.current = false;
      void startTour(saved.tourSlug, { initialStepIndex: saved.stepIndex });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function startTour(id: string, opts?: StartTourOpts) {
    const tour = getTour(id);
    if (!tour) {
      // eslint-disable-next-line no-console
      console.warn(`startTour: unknown tour id "${id}"`);
      return;
    }
    if (tour.prerequisite && !(await tour.prerequisite())) return;

    const mobile = isMobileViewport();
    const useSpotlight = tour.style === 'spotlight' && !mobile;

    // Drop steps whose target isn't in the DOM right now — e.g. sidebar tiles a
    // staff member's permissions hide, or dashboard widgets that didn't render.
    const liveSteps =
      typeof document !== 'undefined'
        ? resolvableSteps(tour.steps, (sel) => !!document.querySelector(sel))
        : tour.steps;
    if (liveSteps.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`startTour: no resolvable targets for "${id}"`);
      return;
    }

    // A4: mobile spotlight tours inject a one-step notice before the popover steps.
    const steps = mobile && tour.style === 'spotlight'
      ? [mobileNoticeStep(), ...liveSteps]
      : liveSteps;

    setCurrentTourId(id);

    const baseSteps = steps.map((s) => ({
      element: s.target,
      popover: {
        title: s.title,
        description:
          s.body + ('aside' in s && s.aside ? `<div class="oonb-aside">${s.aside}</div>` : ''),
        side: s.placement ?? 'bottom',
      },
    }));

    // High-water mark of the furthest step the user reached.
    let highestStepReached = 0;

    // A11: respect reduced-motion for driver.js's rAF tweens (animate + smoothScroll).
    const reduced = prefersReducedMotion();

    const d = driver({
      animate: !reduced,
      smoothScroll: !reduced,
      popoverClass: useSpotlight ? 'oonb-spotlight-driver-popover' : undefined,
      showProgress: !useSpotlight,
      showButtons: useSpotlight ? [] : ['next', 'previous', 'close'],
      stagePadding: useSpotlight ? 12 : 6,
      stageRadius: useSpotlight ? 8 : 4,
      overlayOpacity: useSpotlight ? 0.7 : 0.5,
      onHighlightStarted: (_el, _step, opts_) => {
        const idx = opts_?.state.activeIndex ?? 0;
        if (idx > highestStepReached) highestStepReached = idx;

        // A2: persist step so navigation can resume here.
        saveTourState({ tourSlug: id, stepIndex: idx, startedAt: Date.now() });

        if (useSpotlight) {
          // liveSteps drives the chrome content; steps[idx] could be the mobile notice
          // on the mobile path, but spotlight is never used on mobile so this is safe.
          setSpotlight({
            tour,
            step: liveSteps[idx],
            index: idx,
            total: liveSteps.length,
            moveNext: () => driverRef.current?.moveNext(),
            movePrev: () => driverRef.current?.movePrevious(),
            exit: () => driverRef.current?.destroy(),
          });
        }
      },
      onDestroyed: () => {
        const shouldTick = shouldCompleteTour(tour.style, highestStepReached, liveSteps.length);
        void (async () => {
          if (shouldTick) {
            // A2: tour completed legitimately — clear the nav-resume state.
            clearTourState();
            await progressClient.markTourComplete(id);
            if (tour.checklistKey) {
              await progressClient.tickChecklist(tour.checklistKey);
            }
          } else if (!navInterruptRef.current) {
            // User skipped/escaped — clear so we don't accidentally resume later.
            clearTourState();
          }
          // If navInterruptRef.current, sessionStorage is intentionally preserved
          // so the pathname effect can resume on the next route.
          await reloadProgress();
          setCurrentTourId(null);
          setSpotlight(null);
        })();
      },
      steps: baseSteps,
    });
    driverRef.current = d;
    d.drive(opts?.initialStepIndex ?? 0);
  }

  function endTour() {
    clearTourState();
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
