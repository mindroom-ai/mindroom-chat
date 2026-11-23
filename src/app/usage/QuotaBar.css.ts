import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Root = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
});

export const Header = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: config.space.S200,
});

export const Label = style({
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  color: color.Surface.OnContainer,
});

export const Percent = style({
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W600,
  fontVariantNumeric: 'tabular-nums',
  color: color.Surface.OnContainer,
  selectors: {
    '&[data-tone="warning"]': { color: color.Warning.Main },
    '&[data-tone="critical"]': { color: color.Critical.Main },
  },
});

export const Track = style({
  position: 'relative',
  blockSize: toRem(8),
  inlineSize: '100%',
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.ContainerHover,
  overflow: 'visible',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '2px',
    },
  },
});

export const Fill = style({
  blockSize: '100%',
  borderRadius: config.radii.Pill,
  transition: 'inline-size 180ms ease',
});

export const PaceTick = style({
  position: 'absolute',
  insetBlockStart: toRem(-2),
  inlineSize: toRem(2),
  blockSize: toRem(12),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Surface.OnContainer,
  opacity: 0.72,
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
});

export const Meta = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: config.space.S100,
  fontSize: config.fontSize.T200,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
});

export const InlineRoot = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(5),
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: 'normal',
  textTransform: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  color: color.Surface.OnContainer,
});

export const InlineItem = style({
  selectors: {
    '&[data-tone="warning"]': { color: color.Warning.Main, fontWeight: config.fontWeight.W600 },
    '&[data-tone="critical"]': { color: color.Critical.Main, fontWeight: config.fontWeight.W600 },
  },
});

export const InlineDot = style({
  opacity: 0.55,
});
