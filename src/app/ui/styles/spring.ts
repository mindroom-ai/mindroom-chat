/**
 * A damped spring on a unit mass, for motion that follows a target which may itself move (a pill
 * over a tab whose width animates). `stepSpring` advances it frame by frame in JavaScript;
 * `springEasing` samples the same curve as a CSS `linear()` easing, so a transition can keep step
 * with it.
 */
export type Spring = { stiffness: number; damping: number };
export type SpringState = { value: number; velocity: number };

// Over `ms`, an envelope of e^(-ratio * 7.5) leaves well under 1% of the distance to go.
const angularFrequency = (ms: number): number => 7.5 / (ms / 1000);

/** The spring with damping ratio `ratio` (1 is critical) that settles in about `ms`. */
export const springOf = (ratio: number, ms: number): Spring => {
  const frequency = angularFrequency(ms);
  return { stiffness: frequency * frequency, damping: 2 * ratio * frequency };
};

// Semi-implicit Euler stays stable for these springs at steps of 4 ms and below.
const MAX_STEP_SECONDS = 0.004;

/** The state `seconds` later, pulled toward `target`. */
export const stepSpring = (
  state: SpringState,
  target: number,
  seconds: number,
  spring: Spring
): SpringState => {
  let { value, velocity } = state;
  const steps = Math.max(1, Math.ceil(seconds / MAX_STEP_SECONDS));
  const step = seconds / steps;
  for (let index = 0; index < steps; index += 1) {
    velocity += (spring.stiffness * (target - value) - spring.damping * velocity) * step;
    value += velocity * step;
  }
  return { value, velocity };
};

/** Whether a spring measured in CSS pixels sits still enough at `target` to stop drawing it. */
export const springSettled = ({ value, velocity }: SpringState, target: number): boolean =>
  Math.abs(target - value) < 0.5 && Math.abs(velocity) < 5;

/** The curve of an underdamped spring (`ratio` below 1) over `ms`, as a CSS `linear()` easing. */
export const springEasing = (ratio: number, ms: number): string => {
  const frequency = angularFrequency(ms);
  const damped = frequency * Math.sqrt(1 - ratio * ratio);
  const samples = 48;
  const points = Array.from({ length: samples + 1 }, (_, index) => {
    if (index === samples) return 1;
    const t = ((index / samples) * ms) / 1000;
    const decay = Math.exp(-ratio * frequency * t);
    const x =
      1 - decay * (Math.cos(damped * t) + ((ratio * frequency) / damped) * Math.sin(damped * t));
    return Number(x.toFixed(4));
  });
  return `linear(${points.join(', ')})`;
};
