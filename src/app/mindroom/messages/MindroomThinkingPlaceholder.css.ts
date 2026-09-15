import { keyframes, style } from '@vanilla-extract/css';
import { color, config } from 'folds';

const shimmer = keyframes({
  '0%': { backgroundPosition: '180% 50%' },
  '100%': { backgroundPosition: '-80% 50%' },
});

// First 9 seconds: whole-M flips. Last 6 seconds: the core takes its turn.
const turn = keyframes({
  '0%, 6%': {
    transform: 'translateY(0%) rotateX(0deg) rotateY(0deg) rotateZ(0deg)',
  },
  '9%': {
    transform: 'translateY(2%) rotateX(-5deg) rotateY(-24deg) rotateZ(-3deg)',
  },
  '13.2%': {
    transform: 'translateY(-7%) rotateX(5deg) rotateY(382deg) rotateZ(3deg)',
  },
  '16.2%': {
    transform: 'translateY(2%) rotateX(0deg) rotateY(350deg) rotateZ(-1.3deg)',
  },
  '19.2%, 35.4%': {
    transform: 'translateY(0%) rotateX(0deg) rotateY(360deg) rotateZ(0deg)',
  },
  '38.4%': {
    transform: 'translateY(3%) rotateX(-22deg) rotateY(360deg) rotateZ(2deg)',
  },
  '43.2%': {
    transform: 'translateY(-5%) rotateX(381deg) rotateY(360deg) rotateZ(-2deg)',
  },
  '46.2%': {
    transform: 'translateY(1%) rotateX(351deg) rotateY(360deg) rotateZ(1deg)',
  },
  '49.8%, 60%, 100%': {
    transform: 'translateY(0%) rotateX(360deg) rotateY(360deg) rotateZ(0deg)',
  },
});
const core = keyframes({
  '0%, 60%, 65.6%': {
    transform: 'translateY(0px) rotateY(0deg) scale(1, 1)',
    filter: 'drop-shadow(0 0 9px #ffe39b30)',
  },
  '68.8%': {
    transform: 'translateY(18px) rotateY(-22deg) scale(1.03, 0.93)',
    filter: 'drop-shadow(0 0 9px #ffe39b45)',
  },
  '73.6%': {
    transform: 'translateY(-54px) rotateY(385deg) scale(0.97, 1.05)',
    filter: 'drop-shadow(0 0 36px #ffe39bb0)',
  },
  '76.8%': {
    transform: 'translateY(13.5px) rotateY(350deg) scale(1.025, 0.96)',
    filter: 'drop-shadow(0 0 18px #ffe39b75)',
  },
  '80.4%': {
    transform: 'translateY(-9px) rotateY(364deg) scale(0.99, 1.015)',
    filter: 'drop-shadow(0 0 18px #ffe39b60)',
  },
  '84.8%, 100%': {
    transform: 'translateY(0px) rotateY(360deg) scale(1, 1)',
    filter: 'drop-shadow(0 0 9px #ffe39b30)',
  },
});
const glow = keyframes({
  '0%, 60%, 65.6%, 100%': {
    opacity: '0.2',
    transform: 'scale(1.2)',
  },
  '68.8%': {
    opacity: '0.35',
    transform: 'scale(1.1)',
  },
  '73.6%': {
    opacity: '1',
    transform: 'scale(1.8)',
  },
  '78.4%': {
    opacity: '0.4',
    transform: 'scale(1.3)',
  },
  '81.6%': {
    opacity: '0.55',
    transform: 'scale(1.45)',
  },
  '86.8%': {
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
  maxWidth: '100%',
  gap: config.space.S200,
  color: 'inherit',
  font: 'inherit',
  fontWeight: 700,
  verticalAlign: 'baseline',
});

export const Indicator = style({
  display: 'inline-block',
  position: 'relative',
  flex: '0 0 auto',
  width: '1.5em',
  height: '1.5em',
  perspective: '7em',
  isolation: 'isolate',
});

export const Aura = style({
  position: 'absolute',
  inset: '-12%',
  borderRadius: '50%',
  background: 'radial-gradient(ellipse, #ffcf6740, transparent 72%)',
  opacity: 0.2,
  pointerEvents: 'none',
  animation: `${glow} 15s ease-in-out infinite`,
  '@media': reducedMotion,
});

export const Rotor = style({
  position: 'absolute',
  inset: 0,
  transformOrigin: '50% 50%',
  backfaceVisibility: 'visible',
  animation: `${turn} 15s cubic-bezier(0.2, 0.7, 0.3, 1) infinite`,
  '@media': reducedMotion,
});

export const Mark = style({
  display: 'block',
  width: '100%',
  height: '100%',
});

export const Core = style({
  transformBox: 'fill-box',
  transformOrigin: 'center',
  animation: `${core} 15s cubic-bezier(0.2, 0.7, 0.3, 1) infinite`,
  '@media': reducedMotion,
});

export const Text = style({
  display: 'inline-block',
  maxWidth: '100%',
  color: 'transparent',
  backgroundImage: `linear-gradient(100deg, ${color.Secondary.Main} 0%, ${color.Primary.Main} 36%, ${color.Surface.OnContainer} 50%, ${color.Primary.Main} 64%, ${color.Secondary.Main} 100%)`,
  backgroundSize: '220% 100%',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  animation: `${shimmer} 2.2s linear infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      color: 'inherit',
      backgroundImage: 'none',
    },
  },
});
