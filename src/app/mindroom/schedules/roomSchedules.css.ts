import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The room header's schedules button; the count sits on its corner.
export const Trigger = style({
  position: 'relative',
});

export const Count = style({
  position: 'absolute',
  top: toRem(2),
  insetInlineEnd: toRem(2),
  minWidth: toRem(14),
  height: toRem(14),
  padding: `0 ${toRem(3)}`,
  borderRadius: config.radii.Pill,
  backgroundColor: color.Secondary.Main,
  color: color.Secondary.OnMain,
  fontSize: toRem(9),
  fontWeight: config.fontWeight.W600,
  lineHeight: toRem(14),
  textAlign: 'center',
  pointerEvents: 'none',
});

export const Dialog = style({
  width: `min(${toRem(560)}, 100vw)`,
  maxWidth: '100vw',
  maxHeight: 'min(85vh, 100dvh)',
  overflow: 'hidden',
});

export const Header = style({
  gap: config.space.S200,
  paddingInline: config.space.S400,
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

// The task cards, one under the other.
export const Content = style({
  padding: config.space.S400,
  minWidth: 0,
});

export const Empty = style({
  padding: `${config.space.S500} ${config.space.S300}`,
  alignItems: 'center',
  textAlign: 'center',
});

export const Card = style({
  minWidth: 0,




});

// Long words, URLs and display names wrap instead of widening the card on phones.
export const Wrap = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
});

export const Prompt = style([
  Wrap,
  {
    whiteSpace: 'pre-wrap',
    // The prompt is quoted: a bar at its start, as in a block quote.
    margin: 0,
    paddingInlineStart: config.space.S300,
    borderInlineStart: `${config.borderWidth.B600} solid ${color.SurfaceVariant.ContainerLine}`,
  },
]);

export const Metadata = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
  columnGap: config.space.S300,
  rowGap: config.space.S100,
  margin: 0,
  minWidth: 0,
  '@media': {
    '(max-width: 360px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});

globalStyle(`${Metadata} dt`, { opacity: config.opacity.P400 });
globalStyle(`${Metadata} dd`, { margin: 0, minWidth: 0 });

export const Awaiting = style({
  color: color.Warning.Main,
  fontWeight: config.fontWeight.W500,
});
