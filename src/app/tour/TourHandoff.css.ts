import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../ui/styles/Motion.css';

/** How long one pulse of the ring takes, in ms; it pulses twice. */
export const PULSE_MS = 700;

/**
 * The layer the ring is placed in: over the whole window, left to right in every language, so
 * the ring's place counts from the window's left edge as the composer's measured place does.
 */
export const Layer = style({
  position: 'fixed',
  inset: 0,
  zIndex: config.zIndex.Max,
  direction: 'ltr',
  pointerEvents: 'none',
});

const ring = `0 0 0 ${toRem(2)} ${color.Primary.Main}`;
const glow = `color-mix(in srgb, ${color.Primary.Main} 40%, transparent)`;

const pulse = keyframes({
  '0%': { opacity: 0, boxShadow: `${ring}, 0 0 0 0 ${glow}` },
  '30%': { opacity: 1, boxShadow: `${ring}, 0 0 0 ${toRem(4)} ${glow}` },
  '100%': { opacity: 0, boxShadow: `${ring}, 0 0 0 ${toRem(14)} transparent` },
});

/** The tour's ring around the room's composer: it comes, spreads and goes, twice. */
export const Ring = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineStart: 0,
  borderRadius: `calc(${config.radii.R400} + ${toRem(4)})`,
  opacity: 0,
  animation: `${pulse} ${PULSE_MS}ms ${motion.easing.Standard} 2`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});
