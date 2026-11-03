import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';





  padding: `${toRem(48)} ${config.space.S300}`,
  position: 'relative',
  isolation: 'isolate',
  // Empty space passes pointer input through to the particle canvas behind the layout.
  pointerEvents: 'none',
});

globalStyle(
  `${AuthLayout} :is(a, button, input, select, textarea, label, [tabindex]:not([tabindex='-1']))`,
  { pointerEvents: 'auto' }
);

/** The persistent particle background shows through instead of the solid background. */
export const AuthLayoutPersistentParticle = style({






  pointerEvents: 'auto',





































  pointerEvents: 'auto',
  padding: config.space.S200,
});
