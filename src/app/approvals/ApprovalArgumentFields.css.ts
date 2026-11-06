import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { touchTarget } from '../ui/styles/touchTarget';

// Argument rows sit inside an approval or tool surface, which owns the glass.
export const Fields = style({
  display: 'grid',
  gridTemplateColumns: `minmax(${toRem(56)}, max-content) minmax(0, 1fr)`,
  columnGap: config.space.S300,
  rowGap: config.space.S100,
  margin: 0,
  minWidth: 0,
  fontSize: toRem(13),
  lineHeight: 1.5,
});

export const Key = style({
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12),
  lineHeight: toRem(20),
  opacity: config.opacity.P400,
  overflowWrap: 'anywhere',
});

export const Value = style({
  margin: 0,
  minWidth: 0,
  whiteSpace: 'pre-line',
  overflowWrap: 'anywhere',
});

export const Clamped = style({
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const Scalar = style({
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12.5),
});

export const Code = style({
  borderRadius: config.radii.R300,
  paddingBlock: config.space.S100, paddingInline: config.space.S200,
  margin: 0,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.ContainerActive} 45%, transparent)`,
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12.5),
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

// To a finger it reaches 5 px up and down, halfway to the decision buttons below it.
export const Toggle = style([
  { alignSelf: 'flex-start' },
  touchTarget('22px', '', { blockReach: '5px' }),
]);

export const Count = style({
  opacity: config.opacity.P400,
  fontWeight: config.fontWeight.W400,
});

export const Arguments = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  minWidth: 0,
});
