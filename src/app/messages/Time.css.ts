import { keyframes, style } from '@vanilla-extract/css';
import { color } from 'folds';
import { motion } from '../ui/styles/Motion.css';
import { transition } from '../ui/styles/transition';
import { MessageBase } from './styles.css';

/** An agent reply's time: its start and duration, which unfolds its finish and exact duration. */
export const ReplyTime = style({
  display: 'inline-flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
  cursor: 'default',
  borderRadius: '4px',
});

/**
 * A part of the time that unfolds while the pointer hovers the time, the keyboard focuses its
 * message row, or a tap opened it: its width grows from none to its text's (grid `0fr` to `1fr`)
 * as it fades in.
 */
export const Fold = style({
  display: 'inline-grid',
  gridTemplateColumns: '0fr',
  transition: transition(['grid-template-columns'], motion.duration.Slower),
  selectors: {
    [`${MessageBase}:focus-visible &, ${ReplyTime}[data-open] &`]: {
      gridTemplateColumns: '1fr',
    },
  },
  '@media': {
    '(hover: hover)': {
      selectors: { [`${ReplyTime}:hover &`]: { gridTemplateColumns: '1fr' } },
    },
  },
});

export const FoldText = style({
  overflow: 'hidden',
  minWidth: 0,
  opacity: 0,
  transition: transition(['opacity'], motion.duration.Slower),
  selectors: {
    [`${MessageBase}:focus-visible &, ${ReplyTime}[data-open] &`]: { opacity: 1 },
  },
  '@media': {
    '(hover: hover)': {
      selectors: { [`${ReplyTime}:hover &`]: { opacity: 1 } },
    },
  },
});

/** The parts of a streaming reply's time that run live. */
export const Live = style({ color: color.Success.Main });

const pulse = keyframes({ '50%': { opacity: 0.35 } });

/** The dot before a streaming reply's time; it pulses, except with reduced motion. */
export const Dot = style({
  inlineSize: '6px',
  blockSize: '6px',
  flexShrink: 0,
  borderRadius: '50%',
  marginInlineEnd: '5px',
  backgroundColor: color.Success.Main,
  animation: `${pulse} 1.4s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': { animation: 'none' },
  },
});
