import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** A segmented control: a `radiogroup` whose options are `radio` buttons. */
export const Segments = style({
  display: 'inline-flex',
  flexShrink: 0,
  padding: toRem(2),
  columnGap: toRem(2),
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
});

export const Segment = style({
  padding: `${toRem(4)} ${config.space.S200}`,
  border: 0,
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(13),
  cursor: 'pointer',
  selectors: {
    '&[aria-checked=true]': {
      backgroundColor: color.Surface.Container,
      color: color.Surface.OnContainer,
      fontWeight: 600,
    },
    '&:focus-visible': { outline: `${config.borderWidth.B400} solid ${color.Primary.Main}` },
  },
});
