'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTour } from './TourProvider';
import {
  prefersReducedMotion,
  resolveAutoAdvanceMs,
} from './spotlight-internals';

export function SpotlightChrome() {
  const { spotlight } = useTour();
  const [mounted, setMounted] = useState(false);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  function pause() {
    setPaused(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    if (!spotlight) return;
    if (paused) return;
    const ms = resolveAutoAdvanceMs(spotlight.tour.autoAdvance, prefersReducedMotion());
    if (ms === null) return;
    timerRef.current = setTimeout(() => {
      spotlight.moveNext();
    }, ms);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [spotlight?.index, paused, spotlight]);

  useEffect(() => {
    if (!spotlight) return;
    function onKey(e: KeyboardEvent) {
      if (!spotlight) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        pause();
        spotlight.moveNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        pause();
        spotlight.movePrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        spotlight.exit();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [spotlight]);

  if (!mounted || !spotlight) return null;

  const { index, total, step } = spotlight;

  // GSAP-style expo.out tween for the label crossfade. Lands in ~280ms with the
  // tail-decay feel of GSAP's power4.out — snappier than a spring, no overshoot.
  const labelTransition = reduced
    ? { duration: 0 }
    : { type: 'tween' as const, duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };
  // Tight snap-spring for the active dot — pops into place, settles fast.
  const dotTransition = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 700, damping: 30, mass: 0.4 };
  // Deep, fast button compress.
  const tapTransition = reduced
    ? undefined
    : { type: 'spring' as const, stiffness: 900, damping: 28 };

  return createPortal(
    <div className="oonb-spotlight-chrome" role="presentation">
      <div
        className="oonb-spotlight-progress"
        aria-label={`Step ${index + 1} of ${total}`}
      >
        {Array.from({ length: total }).map((_, i) => (
          <motion.span
            key={i}
            className={`oonb-spotlight-dot ${i === index ? 'is-active' : ''}`}
            aria-hidden="true"
            animate={{
              scale: i === index ? 1.3 : 1,
              backgroundColor:
                i === index ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.15)',
            }}
            transition={dotTransition}
          />
        ))}
      </div>

      <div className="oonb-spotlight-actions">
        <motion.button
          type="button"
          className="pill"
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={tapTransition}
          onClick={() => {
            pause();
            spotlight.movePrev();
          }}
          disabled={index === 0}
          aria-label="Previous step"
        >
          Back
        </motion.button>
        <motion.button
          type="button"
          className="pill"
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={tapTransition}
          onClick={() => {
            pause();
            spotlight.moveNext();
          }}
          aria-label="Next step"
        >
          {index === total - 1 ? 'Finish' : 'Next'}
        </motion.button>
        <motion.button
          type="button"
          className="pill"
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={tapTransition}
          onClick={() => spotlight.exit()}
          aria-label="Skip tour"
        >
          Skip
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          className="oonb-spotlight-label"
          role="dialog"
          aria-live="polite"
          aria-labelledby="oonb-spotlight-title"
          // x: '-50%' preserves the CSS horizontal centering — Framer's transform
          // would otherwise clobber the translateX(-50%) on `.oonb-spotlight-label`.
          initial={reduced ? false : { opacity: 0, y: 14, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, x: '-50%' }}
          transition={labelTransition}
        >
          <p className="oonb-label">
            STEP {index + 1} / {total}
          </p>
          <h3 id="oonb-spotlight-title">{step.title}</h3>
          <p>{step.body}</p>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
