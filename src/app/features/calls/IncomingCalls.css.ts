import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

// Rings and call notices float above every page at the top end corner, clear of the safe areas,
// one under the other.
export const Host = style({
  display: 'grid',
  rowGap: config.space.S200,
  position: 'fixed',
  top: `calc(env(safe-area-inset-top, 0px) + ${config.space.S400})`,
  insetInlineEnd: `calc(env(safe-area-inset-right, 0px) + ${config.space.S400})`,
  zIndex: 1000,
  width: `min(${toRem(360)}, calc(100vw - 2 * ${config.space.S400}))`,
});

// Who calls on top, the three answers under it.
export const Card = style({
  display: 'grid',
  rowGap: config.space.S300,
  borderRadius: config.radii.R500,
  padding: config.space.S400,
});
