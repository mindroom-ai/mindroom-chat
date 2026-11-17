import { keyframes, style } from '@vanilla-extract/css';
import { color } from 'folds';
import { glow } from './glow';

// The outline is 100 long (its pathLength in OutlineComet.tsx), so this is one lap of it.
const lap = keyframes({ to: { strokeDashoffset: '-100' } });

// The comet's glow. It is on this box, not on the comet: WebKit applies a filter to no shape inside
// an SVG, and clips what an SVG draws outside a filtered box, as the cog's ripple does.
export const Glow = style({
  position: 'absolute',
  inset: 0,
  filter: glow(color.Primary.Main),
  pointerEvents: 'none',
});

// A drawing over an icon, in the icon's own units: what moves on its outline, which is all motion.
export const Outline = style({
  display: 'none',
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      position: 'absolute',
      inset: 0,
      display: 'block',
      inlineSize: '100%',
      blockSize: '100%',
      // The cog's ripple grows past the icon's box.
      overflow: 'visible',
      pointerEvents: 'none',
    },
  },
});

// Three dashes that end at one point, the longer the fainter: a comet that laps the outline.
export const Comet = style({
  stroke: color.Primary.Main,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  animation: `${lap} 2.4s linear infinite`,
});

export const CometHead = style({ stroke: color.Primary.MainLine });
