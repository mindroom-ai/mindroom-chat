import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const dotBase = {
  display: 'block',
  inlineSize: toRem(10),
  blockSize: toRem(10),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
  boxShadow: `0 0 0 ${toRem(2)} ${color.Background.Container}`,
} as const;

export const TipDot = style(dotBase);

export const TopBarFrame = style({
  position: 'relative',
  flexShrink: 0,
  display: 'inline-flex',
});

export const TopBarDot = style({
  ...dotBase,
  position: 'absolute',
  insetBlockStart: toRem(4),
  insetInlineEnd: toRem(4),
  pointerEvents: 'none',
});
