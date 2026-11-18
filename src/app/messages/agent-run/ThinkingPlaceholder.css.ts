import { keyframes, style } from '@vanilla-extract/css';
import { config } from 'folds';

// Horizontal flip, glowing core, vertical flip; rest about 0.5s between phases.
const turn = keyframes({
  '0%, 3%': {
    transform: 'translateY(0%) rotateX(0deg) rotateY(0deg) rotateZ(0deg)',
  },
  '8%': {
    transform: 'translateY(2%) rotateX(-5deg) rotateY(-24deg) rotateZ(-3deg)',
  },
  '15%': {
    transform: 'translateY(-7%) rotateX(5deg) rotateY(382deg) rotateZ(3deg)',
  },
  '20%': {
    transform: 'translateY(2%) rotateX(0deg) rotateY(350deg) rotateZ(-1.3deg)',
  },
  '25%, 73%': {
    transform: 'translateY(0%) rotateX(0deg) rotateY(360deg) rotateZ(0deg)',
  },
  '78%': {
    transform: 'translateY(3%) rotateX(-22deg) rotateY(360deg) rotateZ(2deg)',
  },
  '86%': {
    transform: 'translateY(-5%) rotateX(381deg) rotateY(360deg) rotateZ(-2deg)',
  },
  '91%': {
    transform: 'translateY(1%) rotateX(351deg) rotateY(360deg) rotateZ(1deg)',
  },
  '97%, 100%': {
    transform: 'translateY(0%) rotateX(360deg) rotateY(360deg) rotateZ(0deg)',
  },
});
const core = keyframes({
  '0%, 31%': {
    transform: 'translateY(0%) rotateY(0deg) scale(1, 1)',
    filter: 'drop-shadow(0 0 0.025em #ffe39b30)',
  },
  '36.333%': {
    transform: 'translateY(2.5%) rotateY(-22deg) scale(1.03, 0.93)',
    filter: 'drop-shadow(0 0 0.025em #ffe39b45)',
  },
  '44.333%': {
    transform: 'translateY(-7.5%) rotateY(385deg) scale(0.97, 1.05)',
    filter: 'drop-shadow(0 0 0.1em #ffe39bb0)',
  },
  '49.667%': {
    transform: 'translateY(1.875%) rotateY(350deg) scale(1.025, 0.96)',
    filter: 'drop-shadow(0 0 0.05em #ffe39b75)',
  },
  '55.667%': {
    transform: 'translateY(-1.25%) rotateY(364deg) scale(0.99, 1.015)',
    filter: 'drop-shadow(0 0 0.05em #ffe39b60)',
  },
  '63%, 100%': {
    transform: 'translateY(0%) rotateY(360deg) scale(1, 1)',
    filter: 'drop-shadow(0 0 0.025em #ffe39b30)',
  },
});
const glow = keyframes({
  '0%, 31%, 100%': {
    opacity: '0.2',
    transform: 'scale(1.2)',
  },
  '36.333%': {
    opacity: '0.35',
    transform: 'scale(1.1)',
  },
  '44.333%': {
    opacity: '1',
    transform: 'scale(1.8)',
  },
  '52.333%': {
    opacity: '0.4',
    transform: 'scale(1.3)',
  },
  '57.667%': {
    opacity: '0.55',
    transform: 'scale(1.45)',
  },
  '66.333%': {
    opacity: '0.2',
    transform: 'scale(1.2)',
  },
});

const reducedMotion = {
  '(prefers-reduced-motion: reduce)': {
    animation: 'none',
    transform: 'none',
  },
};

export const Placeholder = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4em',
  maxWidth: '100%',
  paddingInlineEnd: config.space.S100,
  font: 'inherit',
  fontWeight: 700,
  verticalAlign: 'baseline',
});

export const Indicator = style({
  display: 'inline-block',
  position: 'relative',
  flex: '0 0 auto',
  width: '2em',
  height: '2em',
  perspective: '7em',
  isolation: 'isolate',
  // Keep the decorative image layers out of image drag, callout and context menus.
  pointerEvents: 'none',
});

export const Aura = style({
  position: 'absolute',
  inset: '-12%',
  borderRadius: '50%',
  background: 'radial-gradient(ellipse, #ffcf6740, transparent 72%)',
  opacity: 0.2,
  pointerEvents: 'none',
  animation: `${glow} 9s ease-in-out infinite`,
  '@media': reducedMotion,
});

export const Rotor = style({
  position: 'absolute',
  inset: 0,
  transformOrigin: '50% 50%',
  backfaceVisibility: 'visible',
  animation: `${turn} 9s cubic-bezier(0.2, 0.7, 0.3, 1) infinite`,
  '@media': reducedMotion,
});

export const Mark = style({
  display: 'block',
  width: '100%',
  height: '100%',
});

export const Core = style({
  // Animate the HTML layer around the core image, not the artwork itself, so
  // each core movement stays a compositor transform.
  position: 'absolute',
  inset: 0,
  // Center of the cube's bounds in the shared 720-unit viewBox.
  transformOrigin: '50% 47.5%',
  willChange: 'transform, filter',
  animation: `${core} 9s cubic-bezier(0.2, 0.7, 0.3, 1) infinite`,
  '@media': reducedMotion,
});
