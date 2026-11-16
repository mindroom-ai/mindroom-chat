import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The columns side by side, scrolled sideways where they do not fit, each scrolling down itself.
export const Board = style({
  display: 'flex',
  flex: '1 1 auto',
  minBlockSize: 0,
  columnGap: config.space.S200,
  paddingInline: config.space.S200,
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollSnapType: 'x proximity',
});

// As wide as a readable card, and never wider than most of a phone's screen or a side panel.
export const Column = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 'none',
  inlineSize: `min(${toRem(320)}, 85%)`,
  minBlockSize: 0,
  scrollSnapAlign: 'start',
});

export const Heading = style({
  display: 'flex',
  alignItems: 'baseline',
  columnGap: config.space.S100,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  flex: 'none',
});

export const Count = style({
  color: color.SurfaceVariant.OnContainer,
  fontVariantNumeric: 'tabular-nums',
});

export const More = style({
  flex: 'none',
  marginBlock: config.space.S100,
  marginInline: config.space.S300,
});

export const Frame = style({
  display: 'flex',
  flex: '1 1 auto',
  minBlockSize: 0,
  blockSize: '100%',
});

export const Empty = style({
  flex: '1 1 auto',
});

export const Line = style({
  padding: config.space.S300,
  textAlign: 'center',
});
