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

    setCurrentTourId(id);
    const d = driver({
      animate: true,
      showProgress: true,
      smoothScroll: true,
      onDestroyed: () => {
        void (async () => {
          await progressClient.markTourComplete(id);
          if (tour.checklistKey) {
            await progressClient.tickChecklist(tour.checklistKey);
          }
          await reloadProgress();
          setCurrentTourId(null);
        })();
      },
      steps: tour.steps.map((s) => ({
        element: s.target,
        popover: {
          title: s.title,
          description:
            s.body + (s.aside ? `<div class="oonb-aside">${s.aside}</div>` : ''),
          side: s.placement ?? 'bottom',
        },
      })),
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentTourId, progress, videosByTourId, isHelpOpen, isChecklistOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTour() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>');
  return ctx;
}
