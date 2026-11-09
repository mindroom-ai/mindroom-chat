import { style } from '@vanilla-extract/css';
import { shortViewport } from '../ui/styles/shortViewport';
import { color, config, toRem } from 'folds';

const stripHeight = toRem(28);
// What the row keeps below it of the bottom safe area: the home indicator's 13 px and a gap.
const homeIndicatorClearance = '14px';

// The row under the composer. It keeps its height while empty, so the composer never moves
// when someone starts or stops following. Above an iPhone's or iPad's home indicator it reaches
// into the bottom safe area, which the footer keeps below it, down to 14 px above the screen's
// edge, so the composer sits lower without the names meeting the indicator. Elsewhere that area
// holds system buttons (Android's navigation bar), so the row stays above it.
export const FollowingStrip = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  minBlockSize: stripHeight,
  paddingInline: config.space.S400,
  minWidth: 0,
  // Only iOS WebKit has the property.
  '@supports': {
    '(-webkit-touch-callout: none)': {
      marginBlockEnd: `calc(-1 * clamp(0px, env(safe-area-inset-bottom, 0px) - ${homeIndicatorClearance}, ${stripHeight}))`,
    },
  },
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
