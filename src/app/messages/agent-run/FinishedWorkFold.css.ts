import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { glow } from './glow';

// The Worked for row is the reasoning header's (Reasoning.css.ts), with a clock for the bulb.
// Under the pointer or the keyboard's focus the clock lights up as the tool-call cog's gear does,
// its hands sweep one lap back and a light runs through the label: a time-lapse of the work.

// The tool-call cog's ripple (ToolCallsFold.css.ts).
const spread = keyframes({
  from: { opacity: 0.9, transform: 'scale(1)' },
  to: { opacity: 0, transform: 'scale(2.4)' },
});
const sweep = keyframes({ to: { transform: 'rotate(-360deg)' } });
const shine = keyframes({
  from: { backgroundPosition: '100% 0' },
  to: { backgroundPosition: '0 0' },
});
const unfold = keyframes({
  from: { gridTemplateRows: '0fr', marginTop: 0, opacity: 0 },
  to: { gridTemplateRows: '1fr', marginTop: config.space.S100, opacity: 1 },
});
const foldUp = keyframes({
  from: {
    gridTemplateRows: '1fr',
    marginTop: config.space.S100,
    opacity: 1,
    visibility: 'visible',
  },
  to: { gridTemplateRows: '0fr', marginTop: 0, opacity: 0, visibility: 'hidden' },
});
// The work while it folds back, as it ends: what shows if the slide stops before its end.
const folded = { gridTemplateRows: '0fr', marginTop: 0, opacity: 0, visibility: 'hidden' } as const;

/** The row's button, on top of the reasoning header's Toggle. A press sinks it a little. */
export const Row = style({
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      transition: 'opacity 150ms ease, scale 120ms ease',
      selectors: { '&:active': { scale: '0.96' } },
    },
  },
});

const lit = { color: color.Primary.MainLine, filter: glow(color.Primary.Main) };

/** The clock's box, which the ring a click sheds is drawn over. */
export const ClockBox = style({
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
});

/** As large as folds' Icon of size 50, which the row's other icons are. */
export const Clock = style({
  inlineSize: toRem(16),
  blockSize: toRem(16),
  flexShrink: 0,
  selectors: { [`${Row}:focus-visible &`]: lit },
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      transition: 'color 300ms ease, filter 300ms ease',
    },
    '(hover: hover)': { selectors: { [`${Row}:hover &`]: lit } },
  },
});

const sweeping = { animation: `${sweep} 1100ms cubic-bezier(0.45, 0, 0.25, 1) both` };

/** The hands, which turn about the middle of the face. */
export const Hands = style({
  transformBox: 'view-box',
  transformOrigin: '12px 12px',
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      selectors: { [`${Row}:focus-visible &`]: sweeping },
    },
    '(hover: hover) and (prefers-reduced-motion: no-preference)': {
      selectors: { [`${Row}:hover &`]: sweeping },
    },
  },
});

// The light is the label's own color with the accent in its middle, so the label reads as it does
// at rest where the light is not.
const shining = {
  background: `linear-gradient(90deg, currentColor 0 40%, ${color.Primary.Main} 50%, currentColor 60% 100%) 100% 0 / 250% 100% no-repeat`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  animation: `${shine} 1100ms ease-in-out both`,
};

export const Label = style({
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      selectors: { [`${Row}:focus-visible &`]: shining },
    },
    '(hover: hover) and (prefers-reduced-motion: no-preference)': {
      selectors: { [`${Row}:hover &`]: shining },
    },
    // Forced colors may drop the light's gradient, which would leave the label blank.
    '(forced-colors: active)': {
      selectors: {
        [`${Row}:hover &, ${Row}:focus-visible &`]: {
          background: 'none',
          WebkitTextFillColor: 'currentColor',
          animation: 'none',
        },
      },
    },
  },
});

// The chevron nudges along the text while the work is folded. `translate` is not turned by the
// reasoning Chevron's right-to-left `transform`, so right to left nudges it the other way.
const nudge = (hovered: string) => ({
  [`${Row}:not([aria-expanded="true"])${hovered} &`]: { translate: `${toRem(2)} 0` },
  [`[dir=rtl] ${Row}:not([aria-expanded="true"])${hovered} &`]: {
    translate: `${toRem(-2)} 0`,
  },
});

export const Chevron = style({
  selectors: nudge(':focus-visible'),
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      selectors: {
        // Above the reasoning Chevron's own transition.
        [`${Row} &`]: {
          transition: 'transform 150ms ease, translate 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        },
      },
    },
    '(hover: hover)': { selectors: nudge(':hover') },
  },
});

/**
 * A click sheds the clock's rim, which grows and fades, as the cog sheds its gear's outline. It
 * shows only while it plays, so no ring stays behind under reduced motion.
 */
export const Ring = style({
  stroke: color.Primary.Main,
  strokeWidth: '1.3',
  transformOrigin: '12px 12px',
  opacity: 0,
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      animation: `${spread} 650ms cubic-bezier(0.2, 0.7, 0.3, 1) both`,
    },
  },
});

/**
 * The work as the reply showed it before it finished. It slides open and folds back by its one
 * grid row, while FinishedWorkFold.tsx sets `data-motion`; it shows at once when it mounts open.
 * Folding back, it rests folded and hidden, so a fold-back whose slide never ends (reduced motion
 * turned on mid-slide) shows nothing and lets nothing in it take focus until the next click.
 */
export const Work = style({
  display: 'grid',
  marginTop: config.space.S100,
  selectors: { '&[data-motion="closing"]': folded },
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      selectors: {
        '&[data-motion="opening"]': {
          animation: `${unfold} ${motion.duration.Slower} ${motion.easing.Decelerate} both`,
        },
        '&[data-motion="closing"]': {
          animation: `${foldUp} ${motion.duration.Slower} ${motion.easing.Accelerate} both`,
        },
      },
    },
  },
});

/** The work's one row, which clips it only while it slides, so at rest nothing of it is cut. */
export const WorkInner = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  selectors: { [`${Work}[data-motion] > &`]: { overflow: 'hidden' } },
});
