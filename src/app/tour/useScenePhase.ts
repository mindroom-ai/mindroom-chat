import { useCallback, useEffect, useState } from 'react';
import { prefersReducedMotion } from './tourMotion';
import { SCENE_START_DELAY_MS, type TourStep, type TourStepId } from './tourSteps';

type Run = { step: TourStepId; phase: number; replays: number };

/** A step's scene from its start, or at its end where nothing should move. */
const startOf = (step: TourStep, replays: number): Run => ({
  step: step.id,
  phase: prefersReducedMotion() ? step.phases.length - 1 : 0,
  replays,
});

/**
 * The phase of a step's scene. It starts a moment after the step comes, goes on by the step's
 * timing and stays in the last phase; `settled` says the last phase shows. A new step starts
 * over, as does `replay()`. With reduced motion the last phase shows at once.
 */
export const useScenePhase = (
  step: TourStep
): { phase: number; settled: boolean; replay: () => void } => {
  const [run, setRun] = useState(() => startOf(step, 0));
  // A new step starts over in the render that brings it, so its scene never shows the old phase.
  let current = run;
  if (run.step !== step.id) {
    current = startOf(step, 0);
    setRun(current);
  }
  const { phase, replays } = current;
  const last = step.phases.length - 1;

  useEffect(() => {
    if (phase >= last) return undefined;
    const length = (step.phases[phase] ?? 0) + (phase === 0 ? SCENE_START_DELAY_MS : 0);
    const timer = setTimeout(
      () => setRun((now) => (now.step === step.id ? { ...now, phase: now.phase + 1 } : now)),
      length
    );
    return () => clearTimeout(timer);
  }, [step, phase, last, replays]);

  const replay = useCallback(() => setRun((now) => startOf(step, now.replays + 1)), [step]);

  return { phase: Math.min(phase, last), settled: phase >= last, replay };
};

/** How many ms the composer takes for each character it types. */
export const TYPING_INTERVAL_MS = 28;

/**
 * How many of a text's `total` characters show: while `typing`, one more every few ms from none;
 * otherwise all of them.
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
      TYPING_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [typing, total]);

  return typing ? Math.min(count, total) : total;
};
