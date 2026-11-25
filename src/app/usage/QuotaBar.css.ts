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
  blockSize: toRem(7),
  inlineSize: '100%',
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.ContainerHover,
  overflow: 'visible',
  selectors: {
    '&:focus-visible': {
      outline: `${toRem(2)} solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
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
  insetBlockStart: toRem(-3),
  inlineSize: toRem(2),
  blockSize: toRem(13),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Surface.OnContainer,
  opacity: 0.85,
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
});

export const MetaInfo = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: config.space.S200,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
});

export const PaceBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(1),
  paddingInline: toRem(7),
  borderRadius: config.radii.Pill,
  fontSize: toRem(11),
  lineHeight: 1.4,
  fontWeight: config.fontWeight.W600,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  marginInlineStart: 'auto',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  selectors: {
    '&[data-pace-tone="ahead"]': {
      color: color.Success.OnContainer,
      borderColor: color.Success.ContainerLine,
      backgroundColor: color.Success.Container,
    },
    '&[data-pace-tone="behind"]': {
      color: color.Warning.Main,
      borderColor: color.Warning.ContainerLine,
      backgroundColor: color.Warning.Container,
    },
    '&[data-pace-tone="on_pace"]': {
      opacity: config.opacity.P400,
    },
  },
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

export const InlineBarTrack = style({
  display: 'inline-block',
  inlineSize: toRem(36),
  blockSize: toRem(4),
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.ContainerHover,
  overflow: 'hidden',
  flexShrink: 0,
});

export const InlineBarFill = style({
  display: 'block',
  blockSize: '100%',
  borderRadius: config.radii.Pill,
});
