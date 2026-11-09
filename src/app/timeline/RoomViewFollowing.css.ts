import { style } from '@vanilla-extract/css';
import { shortViewport } from '../ui/styles/shortViewport';
import { color, config, toRem } from 'folds';

const stripHeight = toRem(28);

// The row under the composer. It keeps its height while empty, so the composer never moves
// when someone starts or stops following. Above a home indicator it lies in the bottom safe area,
// which the footer keeps below it, so the composer rests on that area instead of a row higher.
export const FollowingStrip = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  minBlockSize: stripHeight,
  marginBlockEnd: `calc(-1 * min(env(safe-area-inset-bottom, 0px), ${stripHeight}))`,
  paddingInline: config.space.S400,
  minWidth: 0,
  // Short landscape phones give the row's height to the messages (after the display above).
  '@media': { [shortViewport]: { display: 'none' } },
});

// A frosted label: tint and blur only, no rim or shadow, so it reads as part of the strip.
export const FollowingButton = style({
  all: 'unset',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  maxInlineSize: '100%',
  minWidth: 0,
  cursor: 'pointer',
  paddingBlock: toRem(2),
  paddingInline: config.space.S200,
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
