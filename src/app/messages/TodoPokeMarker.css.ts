import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const SMALL_SCREEN = '(max-width: 34rem)';
const quietInteractive = {
  border: 0,
  borderRadius: config.radii.R300,
  paddingInline: config.space.S100,
  background: 'transparent',
  color: 'inherit',
  opacity: config.opacity.P400,
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'opacity 120ms ease, color 120ms ease, background-color 120ms ease',
  selectors: {
    '&:hover, &:focus-visible': {
      opacity: 1,
      color: color.Primary.OnContainer,
      background: color.Primary.Container,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
} as const;

// Variant C (Quiet Scannable List): subtle left accent rule matching ModelChangeMarker.Panel.
// Hug content up to 48rem so priority pills, IDs, and Hide stay anchored near the text on wide
// timelines, while keeping full column width on narrow/phone screens.
export const Marker = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  inlineSize: 'fit-content',
  minInlineSize: 0,
  maxInlineSize: `min(100%, ${toRem(768)})`,
  alignSelf: 'flex-start',
  paddingBlock: toRem(2),
  paddingInlineStart: config.space.S300,
  borderInlineStart: `${config.borderWidth.B600} solid color-mix(in srgb, ${color.Primary.Main} 42%, ${color.SurfaceVariant.ContainerLine})`,
  '@media': { [SMALL_SCREEN]: { inlineSize: '100%' } },
});

export const Eyebrow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S400,
  minInlineSize: 0,
  '@media': { [SMALL_SCREEN]: { gap: config.space.S200 } },
});

export const EyebrowMain = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: config.space.S100,
  rowGap: toRem(2),
  minInlineSize: 0,
});

globalStyle(`${EyebrowMain} > svg`, { flexShrink: 0, opacity: config.opacity.P400 });

export const Title = style({ fontWeight: config.fontWeight.W600, color: 'inherit' });
export const Meta = style({ minInlineSize: 0, overflowWrap: 'anywhere' });

// Time applies P300 (0.75) opacity on its own; keep it at 1 inside Meta (P400 / 0.9) so opacity
// never compounds below WCAG AA 4.5:1 contrast on light palettes.
globalStyle(`${Meta} time`, { opacity: 1 });

export const Toggle = style({
  ...quietInteractive,
  '@media': { '(pointer: coarse)': { minBlockSize: 44 } },
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: toRem(2),
  font: 'inherit',
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
});

export const Body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  minInlineSize: 0,
});

export const List = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(5),
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const Item = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'baseline',
  columnGap: config.space.S200,
  rowGap: 0,
  minInlineSize: 0,
  '@media': { [SMALL_SCREEN]: { gridTemplateColumns: 'auto minmax(0, 1fr)', rowGap: toRem(2) } },
});

const dotBase = style({
  display: 'inline-block',
  inlineSize: toRem(7),
  blockSize: toRem(7),
  borderRadius: config.radii.Round,
  flexShrink: 0,
  transform: 'translateY(-1px)',
});

export const PriorityDot = styleVariants({
  critical: [dotBase, { backgroundColor: color.Critical.Main }],
  high: [dotBase, { backgroundColor: color.Warning.Main }],
  medium: [dotBase, { backgroundColor: color.Primary.Main }],
  low: [dotBase, { backgroundColor: 'currentColor', opacity: 0.45 }],
});

export const ItemTitle = style({
  minInlineSize: 0,
  overflowWrap: 'anywhere',
  color: 'inherit',
  fontSize: toRem(13),
  lineHeight: 1.4,
});

export const ItemMeta = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  marginInlineStart: config.space.S200,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  '@media': { [SMALL_SCREEN]: { gridColumn: 2, justifySelf: 'start', marginInlineStart: 0 } },
});

const pillBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minInlineSize: toRem(56),
  paddingBlock: toRem(1),
  paddingInline: toRem(6),
  border: `${config.borderWidth.B300} solid transparent`,
  borderRadius: config.radii.Pill,
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W600,
  lineHeight: 1.45,
  flexShrink: 0,
  boxSizing: 'border-box',
});

// Container/OnContainer tokens guarantee >= 5.5:1 WCAG AA contrast across all 23 palettes.
export const PriorityPill = styleVariants({
  critical: [
    pillBase,
    { backgroundColor: color.Critical.Container, color: color.Critical.OnContainer },
  ],
  high: [pillBase, { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer }],
  medium: [
    pillBase,
    {
      backgroundColor: color.SurfaceVariant.Container,
      color: color.SurfaceVariant.OnContainer,
      borderColor: color.SurfaceVariant.ContainerLine,
    },
  ],
  low: [
    pillBase,
    {
      backgroundColor: color.Surface.Container,
      color: color.Surface.OnContainer,
      borderColor: color.SurfaceVariant.ContainerLine,
      opacity: config.opacity.P400,
    },
  ],
});

export const IdButton = style({
  ...quietInteractive,
  '@media': {
    [SMALL_SCREEN]: { minInlineSize: 0, textAlign: 'start' },
    '(pointer: coarse)': { minBlockSize: 44 },
  },
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(11.5),
  fontVariantNumeric: 'tabular-nums',
  paddingBlock: toRem(1),
  minInlineSize: toRem(64),
  textAlign: 'end',
});

export const Overflow = style({ paddingInlineStart: toRem(15) });
