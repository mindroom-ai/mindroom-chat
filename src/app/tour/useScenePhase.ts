import { useCallback, useEffect, useState } from 'react';
import { prefersReducedMotion } from './tourMotion';
import { SCENE_START_DELAY_MS, type TourStep, type TourStepId } from './tourSteps';

type Run = { step: TourStepId; phase: number };

/** A step's scene from its start, or at its end where nothing should move. */
const startOf = (step: TourStep): Run => ({
  step: step.id,
  phase: prefersReducedMotion() ? step.phases.length - 1 : 0,
});

/**
 * The phase of a step's scene. It starts a moment after the step comes, goes on by the step's
 * timing and stays in the last phase; `settled` says the last phase shows. A new step starts
 * over, as does `replay()`. With reduced motion the last phase shows at once.
 */
export const useScenePhase = (
  step: TourStep
): { phase: number; settled: boolean; replay: () => void } => {
  const [run, setRun] = useState(() => startOf(step));
  // A new step starts over in the render that brings it, so its scene never shows the old phase.
  let current = run;
  if (run.step !== step.id) {
    current = startOf(step);
    setRun(current);
  }
  const { phase } = current;
  const last = step.phases.length - 1;

  useEffect(() => {
    if (phase >= last) return undefined;
    const length = (step.phases[phase] ?? 0) + (phase === 0 ? SCENE_START_DELAY_MS : 0);
    const timer = setTimeout(
      () => setRun((now) => (now.step === step.id ? { ...now, phase: now.phase + 1 } : now)),
      length
    );
    return () => clearTimeout(timer);
  }, [step, phase, last]);

  // Offered once the scene has played, so the phase changes and its timer starts anew.
  const replay = useCallback(() => setRun(startOf(step)), [step]);

  return { phase: Math.min(phase, last), settled: phase >= last, replay };
};

/** How long the composer takes to type its whole text, in ms: within the phase that types it. */
export const TYPING_MS = 1000;

/** How many ms the composer takes for each of a text's `total` characters, a longer text less. */
export const typingInterval = (total: number): number =>
  Math.min(45, Math.max(8, Math.floor(TYPING_MS / Math.max(1, total))));

/**
 * How many of a text's `total` characters show: while `typing`, one more every few ms from none,
 * all of them within `TYPING_MS`; otherwise all of them.
 */
export const useTypedLength = (total: number, typing: boolean): number => {
  const [typed, setTyped] = useState({ typing, count: 0 });
  // Typing starts from nothing in the render that starts it.
  let { count } = typed;
  if (typed.typing !== typing) {
    count = 0;
    setTyped({ typing, count });
  }

  useEffect(() => {
    if (!typing) return undefined;
    const timer = setInterval(
      () => setTyped((now) => (now.count >= total ? now : { ...now, count: now.count + 1 })),
      typingInterval(total)
    );
    return () => clearInterval(timer);
  }, [typing, total]);

  return typing ? Math.min(count, total) : total;
};
