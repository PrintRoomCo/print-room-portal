'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTour } from './TourProvider';
import {
  shouldAutoAdvance,
  nextFocusIndex,
} from './spotlight-internals';

export function SpotlightChrome() {
  const { spotlight } = useTour();
  const [mounted, setMounted] = useState(false);
  // STEP-SCOPED pause: records the index a manual interaction happened on, so
  // auto-advance is suppressed only while the user stays on that step and
  // re-arms on the next one. (A plain boolean here was write-once — it killed
  // auto-advance for the rest of the tour after the first click.)
  const [pausedAtIndex, setPausedAtIndex] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  // A13: move focus to Skip when the tour chrome first mounts so keyboard users
  // start inside the tour (Skip is the first focusable control). Runs once —
  // re-focusing per step would steal focus mid-tour.
  useEffect(() => {
    if (mounted && spotlight) skipRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // A14: keep Tab focus cycling within the chrome's controls so it can't leak
  // onto the dimmed page behind the overlay.
  function onTrapKey(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const root = chromeRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    if (focusables.length === 0) return;
    e.preventDefault();
    const current = focusables.indexOf(document.activeElement as HTMLElement);
    if (current < 0) {
      focusables[e.shiftKey ? focusables.length - 1 : 0].focus();
      return;
    }
    focusables[nextFocusIndex(current, focusables.length, e.shiftKey)].focus();
  }

  function pause() {
    setPausedAtIndex(spotlight?.index ?? null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // A17: pause auto-advance when the user clicks the highlighted element (capture phase
  // fires before the click reaches driver.js or triggers Next.js navigation).
  useEffect(() => {
    if (!spotlight) return;
    const el = document.querySelector(spotlight.step.target);
    if (!(el instanceof HTMLElement)) return;
    function onClickCapture() { pause(); }
    el.addEventListener('click', onClickCapture, { capture: true });
    return () => el.removeEventListener('click', onClickCapture, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlight?.index]);

  // A12: use the reactive reduced value from useReducedMotion() so that enabling
  // reduced-motion mid-tour immediately disables the auto-advance timer.
  useEffect(() => {
    if (!spotlight) return;
    const ms = shouldAutoAdvance({
      autoAdvance: spotlight.tour.autoAdvance,
      reducedMotion: reduced ?? false,
      pausedAtIndex,
      currentIndex: spotlight.index,
      totalSteps: spotlight.total,
    });
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
  }, [spotlight?.index, pausedAtIndex, spotlight, reduced]);

  useEffect(() => {
    if (!spotlight) return;
    function onKey(e: KeyboardEvent) {
      if (!spotlight) return;
      if (e.key === 'ArrowRight') {
        // Space is intentionally NOT handled globally: with focus management
        // (A13) a chrome button is focused, so Space must activate THAT button
        // natively rather than also advancing here (which would double-fire).
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
    <div
      className="oonb-spotlight-chrome"
      role="presentation"
      ref={chromeRef}
      onKeyDown={onTrapKey}
    >
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

      {/* A15: stable polite live region — announces each step. (The visible
          label below is aria-hidden; it remounts per step via AnimatePresence,
          which AT reads as a new node rather than a content change.) */}
      <div className="oonb-sr-only" role="status" aria-live="polite">
        {`Step ${index + 1} of ${total}. ${step.title}. ${step.body}`}
      </div>

      {/* A14: DOM order is Skip -> Back -> Next so Skip is the first focusable
          control. Visual order of the pills follows DOM order. */}
      <div className="oonb-spotlight-actions">
        <motion.button
          ref={skipRef}
          type="button"
          className="pill"
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={tapTransition}
          onClick={() => spotlight.exit()}
          aria-label="Skip tour"
        >
          Skip
        </motion.button>
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
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          className="oonb-spotlight-label"
          aria-hidden="true"
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
