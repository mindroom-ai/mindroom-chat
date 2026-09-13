import { style } from '@vanilla-extract/css';

import { PARTICLE_BACKGROUND_RADIAL_GRADIENT } from './particleBackgroundTheme';

export const ParticleBackground = style({
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  pointerEvents: 'none',
  background: PARTICLE_BACKGROUND_RADIAL_GRADIENT,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      opacity: 0.75,
    },
  },
});

export const ParticleBackgroundFixed = style({
  position: 'fixed',
});

export const ParticleCanvas = style({
  width: '100%',
  height: '100%',
  opacity: 1,
  pointerEvents: 'auto',
  '@media': {
    '(hover: none), (pointer: coarse)': {
      pointerEvents: 'none',
    },
    '(prefers-reduced-motion: reduce)': {
      display: 'none',
    },
  },
});
