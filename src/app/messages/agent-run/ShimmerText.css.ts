import { keyframes, style } from '@vanilla-extract/css';
import { color } from 'folds';

const shimmerSweep = keyframes({
  from: { transform: 'translateX(0)' },
  to: { transform: 'translateX(100%)' },
});
const shimmerCounter = keyframes({
  from: { transform: 'translateX(0)' },
  to: { transform: 'translateX(-100%)' },
});

export const Text = style({
  display: 'inline-block',
  fontVariantNumeric: 'tabular-nums',
  position: 'relative',
  overflow: 'hidden',
  minWidth: 0,
  maxWidth: '100%',
});

export const TextBase = style({
  display: 'block',
  color: 'transparent',
  backgroundImage: `linear-gradient(100deg, ${color.Secondary.Main} 0%, ${color.Primary.Main} 36%, ${color.Surface.OnContainer} 50%, ${color.Primary.Main} 64%, ${color.Secondary.Main} 100%)`,
  backgroundSize: '220% 100%',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  '@media': {
    '(prefers-reduced-motion: reduce), (forced-colors: active)': {
      color: 'inherit',
      backgroundImage: 'none',
    },
  },
});

export const TextSweep = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  // eslint-disable-next-line no-restricted-syntax -- the sweep's keyframes move it with translateX, a physical axis
  left: '-3em',
  width: 'calc(100% + 6em)',
  // Move a static mask over counter-moving text so the letters stay aligned.
  // Animating background-position instead repaints the label every frame.
  maskImage: 'linear-gradient(to right, transparent, black 1.5em, transparent 3em, transparent)',
  WebkitMaskImage:
    'linear-gradient(to right, transparent, black 1.5em, transparent 3em, transparent)',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
  pointerEvents: 'none',
  willChange: 'transform',
  animation: `${shimmerSweep} 2.2s linear infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce), (forced-colors: active)': {
      display: 'none',
      animation: 'none',
      willChange: 'auto',
    },
  },
});

export const TextCounter = style({
  display: 'block',
  width: '100%',
  willChange: 'transform',
  animation: `${shimmerCounter} 2.2s linear infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce), (forced-colors: active)': {
      animation: 'none',
      willChange: 'auto',
    },
  },
});

export const TextHighlight = style({
  display: 'block',
  width: 'calc(100% - 6em)',
  marginInline: '3em',
  color: color.Surface.OnContainer,
});
