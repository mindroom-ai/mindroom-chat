import { keyframes } from '@vanilla-extract/css';
import { toRem } from 'folds';
import { motion } from './styles/Motion.css';

// How a floating notice (ui/noticeSlots.tsx) comes and goes: in from the edge it is placed at, a
// little smaller and faded, and out the same way once it goes (its component removes it after
// NOTICE_LEAVE_MS). With reduced motion it only fades: an animation still runs, so leaving takes
// the same time. `data-settled` shows it at once, for a notice rebuilt where it already was;
// `data-leaving` plays it out.

const away = (edge: 1 | -1) => ({
  opacity: 0,
  transform: `translateY(calc(${edge} * ${toRem(8)})) scale(0.98)`,
});
const enterFromBelow = keyframes({ from: away(1) });
const enterFromAbove = keyframes({ from: away(-1) });
const leaveDownward = keyframes({ to: away(1) });
const leaveUpward = keyframes({ to: away(-1) });
const fadeIn = keyframes({ from: { opacity: 0 } });
const fadeOut = keyframes({ to: { opacity: 0 } });

const motionFrom = (enter: string, leave: string) => ({
  animation: `${enter} ${motion.duration.Slow} ${motion.easing.Decelerate}`,
  selectors: {
    '&[data-settled]:not([data-leaving])': { animation: 'none' },
    '&[data-leaving]': {
      animation: `${leave} ${motion.duration.Normal} ${motion.easing.Accelerate} forwards`,
      pointerEvents: 'none' as const,
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationName: fadeIn,
      selectors: { '&[data-leaving]': { animationName: fadeOut } },
    },
  },
});

/** For a notice placed at the bottom of its place, such as the room list's foot. */
export const noticeMotionFromBelow = motionFrom(enterFromBelow, leaveDownward);

/** For a notice placed at the top of its place, such as the page's. */
export const noticeMotionFromAbove = motionFrom(enterFromAbove, leaveUpward);
