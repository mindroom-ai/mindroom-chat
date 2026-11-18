import { style } from '@vanilla-extract/css';
import { shortViewport } from '../ui/styles/shortViewport';
import { color, config, toRem } from 'folds';

// At the end of the dock's row, above the composer, beside the typing strip and the jobs bar: as
// wide as its names, up to half the row, and as tall as the bars beside it. Short landscape
// phones give its line to the messages (after the display above).
export const Following = style({
  display: 'flex',
  flex: '0 1 auto',
  maxInlineSize: '50%',
  minWidth: 0,
  marginBlockEnd: config.space.S200,
  marginInlineStart: 'auto',
  '@media': { [shortViewport]: { display: 'none' } },
});

// A frosted label: tint and blur only, no rim or shadow, lighter than the bars beside it.
export const FollowingButton = style({
  all: 'unset',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  maxInlineSize: '100%',
  minWidth: 0,
  // As tall as the typing strip and the jobs bar: their padding around a 24 px line.
  minBlockSize: toRem(32),
  cursor: 'pointer',
  paddingBlock: config.space.S100,
  paddingInline: config.space.S300,
  borderRadius: config.radii.Pill,
  color: color.SurfaceVariant.OnContainer,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 70%, transparent)`,
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  selectors: {
    '&:hover': {
      backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.ContainerHover} 85%, transparent)`,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
  '@media': {
    '(prefers-reduced-transparency: reduce), (prefers-contrast: more)': {
      backgroundColor: color.SurfaceVariant.Container,
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    },
  },
});
